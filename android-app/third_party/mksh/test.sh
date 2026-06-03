#!/c/code/chainlesschain/android-app/third_party/mksh/mksh
LC_ALL=C PATH='/c/Users/longfa/bin:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:/mingw64/bin:/usr/bin:/c/Users/longfa/bin:/c/Program Files (x86)/Common Files/Oracle/Java/java8path:/c/Program Files (x86)/Common Files/Oracle/Java/javapath:/c/Program Files/Eclipse Adoptium/jdk-17.0.17.10-hotspot/bin:/c/Program Files (x86)/Intel/iCLS Client:/c/Program Files/Intel/iCLS Client:/c/Windows/system32:/c/Windows:/c/Windows/System32/Wbem:/c/Windows/System32/WindowsPowerShell/v1.0:/c/Windows/System32/OpenSSH:/c/Program Files/Intel/Intel(R) Management Engine Components/DAL:/c/Program Files (x86)/Intel/Intel(R) Management Engine Components/DAL:/c/Program Files/Intel/Intel(R) Management Engine Components/IPT:/c/Program Files (x86)/Intel/Intel(R) Management Engine Components/IPT:/cmd:/c/Users/longfa/AppData/Local/nvm:/c/nvm4w/nodejs:/c/Program Files/Docker/Docker/resources/bin:/c/Program Files/GitHub CLI:/c/Users/longfa/.local/bin:/c/Program Files/dotnet:/c/Program Files/Bandizip:/c/Users/longfa/AppData/Local/Programs/Python/Python312/Scripts:/c/Users/longfa/AppData/Local/Programs/Python/Python312:/c/Users/longfa/AppData/Local/Programs/Python/Launcher:/c/Users/longfa/AppData/Local/Microsoft/WindowsApps:/c/Users/longfa/AppData/Local/Programs/Microsoft VS Code/bin:/c/Users/longfa/AppData/Roaming/npm:/c/Users/longfa/AppData/Local/nvm:/c/nvm4w/nodejs:/c/Program Files/JetBrains/IntelliJ IDEA 2021.2.1/bin:/c/Users/longfa/AppData/Local/Microsoft/WinGet/Packages/JohnMacFarlane.Pandoc_Microsoft.Winget.Source_8wekyb3d8bbwe/pandoc-3.9:/c/Users/longfa/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin:/c/Program Files/JetBrains/IntelliJ IDEA 2021.2.1/plugins/maven/lib/maven3/bin:/c/Android/Sdk/platform-tools:/usr/bin/vendor_perl:/usr/bin/core_perl:/c/Users/longfa/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/bin:/c/Users/longfa/.claude/plugins/cache/claude-plugins-official/code-review/unknown/bin:/c/Users/longfa/.claude/plugins/cache/claude-plugins-official/github/unknown/bin:/c/Users/longfa/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/bin'; export LC_ALL PATH
case $KSH_VERSION in
*MIRBSD*|*LEGACY*) ;;
*) exit 1 ;;
esac
set -A check_categories --  shell:legacy-no int:32 shell:textmode-no shell:binmode-yes
pflag='/c/code/chainlesschain/android-app/third_party/mksh/mksh'
sflag='./check.t'
usee=0 useU=0 Pflag=0 Sflag=0 uset=0 vflag=1 xflag=0
while getopts "C:e:fPp:QSs:t:U:v" ch; do case $ch {
(C)	check_categories[${#check_categories[*]}]=$OPTARG ;;
(e)	usee=1; eflag=$OPTARG ;;
(f)	check_categories[${#check_categories[*]}]=fastbox ;;
(P)	Pflag=1 ;;
(+P)	Pflag=0 ;;
(p)	pflag=$OPTARG ;;
(Q)	vflag=0 ;;
(+Q)	vflag=1 ;;
(S)	Sflag=1 ;;
(+S)	Sflag=0 ;;
(s)	sflag=$OPTARG ;;
(t)	uset=1; tflag=$OPTARG ;;
(U)	useU=1; Uflag=$OPTARG ;;
(v)	vflag=1 ;;
(+v)	vflag=0 ;;
(*)	xflag=1 ;;
}
done
shift $((OPTIND - 1))
set -A args -- './check.pl' -p "$pflag"
if false; then
args[${#args[*]}]=-E
fi
x=
for y in "${check_categories[@]}"; do
x=$x,$y
done
if [[ -n $x ]]; then
args[${#args[*]}]=-C
args[${#args[*]}]=${x#,}
fi
if (( usee )); then
args[${#args[*]}]=-e
args[${#args[*]}]=$eflag
fi
(( Pflag )) && args[${#args[*]}]=-P
if (( uset )); then
args[${#args[*]}]=-t
args[${#args[*]}]=$tflag
fi
if (( useU )); then
args[${#args[*]}]=-U
args[${#args[*]}]=$Uflag
fi
(( vflag )) && args[${#args[*]}]=-v
(( xflag )) && args[${#args[*]}]=-x	# force usage by synerr
if [[ -n $TMPDIR && -d $TMPDIR/. ]]; then
args[${#args[*]}]=-T
args[${#args[*]}]=$TMPDIR
fi
print Testing mksh for conformance:
grep -F -e 'KSH R' -e Mir''OS: "$sflag" | sed '/KSH/s/^./&           /'
print "This shell is actually:\n\t$KSH_VERSION"
print 'test.sh built for mksh R59 2020/10/31'
cstr='$os = defined $^O ? $^O : "unknown";'
cstr="$cstr"'print $os . ", Perl version " . $];'
for perli in $PERL perl5 perl no; do
if [[ $perli = no ]]; then
print Cannot find a working Perl interpreter, aborting.
exit 1
fi
print "Trying Perl interpreter '$perli'..."
perlos=$($perli -e "$cstr")
rv=$?
print "Errorlevel $rv, running on '$perlos'"
if (( rv )); then
print "=> not using"
continue
fi
if [[ -n $perlos ]]; then
print "=> using it"
break
fi
done
(( Sflag )) || echo + $perli "${args[@]}" -s "$sflag" "$@"
(( Sflag )) || exec $perli "${args[@]}" -s "$sflag" "$@"
# use of the -S option for check.t split into multiple chunks
rv=0
for s in "$sflag".*; do
echo + $perli "${args[@]}" -s "$s" "$@"
$perli "${args[@]}" -s "$s" "$@"
rc=$?
(( rv = rv ? rv : rc ))
done
exit $rv
