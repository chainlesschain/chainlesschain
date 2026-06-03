#!/usr/bin/env ruby
# frozen_string_literal: true

# Wire individual Swift source files into the ChainlessChain app target's
# Sources build phase. Sister script to wire_spm_packages.rb.
#
# Idempotent — detects existing wiring (by basename in build phase) and skips.
# Run from ios-app/ directory:
#   gem install xcodeproj
#   ruby scripts/wire_app_sources.rb
#
# Triggered via .github/workflows/ios-wire-app-sources.yml (workflow_dispatch).
#
# Background — memory `ios_app_target_compile_state.md`: 184 files in pbxproj
# vs 353+ swift on disk. Many Phase 1-4 features (Pairing, RemoteTerminal,
# RemoteOperate, Notification UI) live on disk but were never added to the
# Xcode project, so `import CoreP2P` types like PairingDependencies are visible
# from CoreP2P but the *app-level glue* that uses them isn't compiled. This
# script wires the safe (Phase 1-4 real impl with tests) subset first.

require 'xcodeproj'

PROJECT_PATH = 'ChainlessChain.xcodeproj'
APP_TARGET   = 'ChainlessChain'

# Paths relative to ios-app/ — keep alphabetized within each feature group
# so the diff is review-friendly.
FILES = %w[
  ChainlessChain/Features/Pairing/PairingDependencies.swift
  ChainlessChain/Features/Pairing/Services/IOSPairingDeviceInfoProvider.swift
  ChainlessChain/Features/Pairing/Views/DesktopPairingView.swift
  ChainlessChain/Features/Pairing/Views/ManualPairingView.swift
  ChainlessChain/Features/Pairing/Views/PairedDevicesListView.swift
  ChainlessChain/Features/Pairing/Views/PairingHomeView.swift
  ChainlessChain/Features/Pairing/Views/ScanDesktopPairingView.swift

  ChainlessChain/Features/RemoteTerminal/JSBridge/TerminalBridge.swift
  ChainlessChain/Features/RemoteTerminal/RemoteDependencies.swift
  ChainlessChain/Features/RemoteTerminal/Views/DcStatusChipView.swift
  ChainlessChain/Features/RemoteTerminal/Views/TerminalListView.swift
  ChainlessChain/Features/RemoteTerminal/Views/TerminalSessionView.swift
  ChainlessChain/Features/RemoteTerminal/Views/TerminalWebView.swift

  ChainlessChain/Features/RemoteOperate/Views/AIExtendedAgentsView.swift
  ChainlessChain/Features/RemoteOperate/Views/AIExtendedMultimodalView.swift
  ChainlessChain/Features/RemoteOperate/Views/AIExtendedView.swift
  ChainlessChain/Features/RemoteOperate/Views/ClipboardView.swift
  ChainlessChain/Features/RemoteOperate/Views/DesktopFrameView.swift
  ChainlessChain/Features/RemoteOperate/Views/FileBrowserView.swift
  ChainlessChain/Features/RemoteOperate/Views/KnowledgeView.swift
  ChainlessChain/Features/RemoteOperate/Views/MultimodalAudioRecorder.swift
  ChainlessChain/Features/RemoteOperate/Views/NotificationsView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteAIChatConversationListView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteAIChatView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteBrowserView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteDesktopView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteDisplayView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteInputView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteMediaView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteOperateView.swift
  ChainlessChain/Features/RemoteOperate/Views/ScreenshotView.swift
  ChainlessChain/Features/RemoteOperate/Views/SkillTabPickerView.swift
  ChainlessChain/Features/RemoteOperate/Views/SystemInfoView.swift
  ChainlessChain/Features/RemoteOperate/Views/SystemToolsView.swift

  ChainlessChain/Features/Common/Services/PushNotificationManager+RemoteTarget.swift
  ChainlessChain/Features/Common/UpdateBannerView.swift

  ChainlessChain/Features/Common/Views/GenericQRScannerView.swift
  ChainlessChain/Features/Common/Views/QrCodeImage.swift
].freeze

abort "❌ #{PROJECT_PATH} not found — run from ios-app/" unless File.exist?(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
target  = project.targets.find { |t| t.name == APP_TARGET }
abort "❌ Target '#{APP_TARGET}' not found in #{PROJECT_PATH}" unless target

# Build a set of basenames already in the Sources build phase for fast dedup.
# Using basename (not path) because pbxproj 'name' attribute is what shows up
# in build logs and is unique within the target.
existing = target.source_build_phase.files.map { |bf|
  bf.file_ref&.name || bf.file_ref&.path&.split('/')&.last
}.compact.to_set

added   = 0
skipped = 0
missing = 0

FILES.each do |rel|
  unless File.exist?(rel)
    puts "⚠️  SKIP (file not on disk): #{rel}"
    missing += 1
    next
  end

  basename = File.basename(rel)
  if existing.include?(basename)
    puts "↻ #{basename}: already in Sources build phase"
    skipped += 1
    next
  end

  # Add file reference DIRECTLY to project.main_group with a FULL relative path
  # (./ChainlessChain/Features/.../Foo.swift) — mirrors existing entries in
  # this pbxproj. Previous attempt used find_subpath to create nested groups,
  # but those groups had no `path` attribute set, so xcodebuild resolved each
  # file as `ios-app/<basename>` (project root) and failed with "Build input
  # files cannot be found" (run 25957731721, commit b6ebe0c37 → revert
  # aac975c64).
  file_ref = project.main_group.new_reference("./#{rel}")
  file_ref.name = basename                             # display name in Xcode
  file_ref.set_source_tree('<group>')
  file_ref.set_last_known_file_type('sourcecode.swift')

  # Add to target's Sources build phase.
  target.source_build_phase.add_file_reference(file_ref, true)
  puts "✓ wired #{rel}"
  added += 1
end

project.save

puts ''
puts '═══════════════════════════════════════════════════'
puts "Summary: #{added} newly wired, #{skipped} already present, #{missing} missing on disk"
puts '═══════════════════════════════════════════════════'

if added.zero?
  puts 'ℹ️  No changes — project.pbxproj untouched'
  exit 0
end

puts 'ℹ️  project.pbxproj modified — review diff & commit:'
puts "    git diff #{PROJECT_PATH}/project.pbxproj | head -100"
