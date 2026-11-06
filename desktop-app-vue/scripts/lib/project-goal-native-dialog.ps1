param(
  [Parameter(Mandatory=$true)][Int64]$WindowHandle,
  [Parameter(Mandatory=$true)][int]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle,
  [Parameter(Mandatory=$true)][string]$ExpectedText
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$nativeWindow = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($WindowHandle))
if ($nativeWindow.Current.ProcessId -ne $TargetProcessId -or $nativeWindow.Current.ClassName -ne '#32770' -or $nativeWindow.Current.Name -ne $ExpectedTitle) {
  throw 'Native dialog owner, class or title differs from the test request'
}
$elements = $nativeWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$names = @($elements | ForEach-Object { $_.Current.Name }) -join "`n"
if (-not $names.Contains($ExpectedText)) { throw 'Native dialog accessibility content differs from the expected synthetic proposal' }
@{ pid=$TargetProcessId; title=$ExpectedTitle; windowClass='#32770'; expectedTextVerified=$true } | ConvertTo-Json -Compress
