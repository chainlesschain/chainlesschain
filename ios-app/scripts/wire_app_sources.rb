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

  ChainlessChain/Features/RemoteOperate/Views/ClipboardView.swift
  ChainlessChain/Features/RemoteOperate/Views/FileBrowserView.swift
  ChainlessChain/Features/RemoteOperate/Views/NotificationsView.swift
  ChainlessChain/Features/RemoteOperate/Views/RemoteOperateView.swift
  ChainlessChain/Features/RemoteOperate/Views/ScreenshotView.swift
  ChainlessChain/Features/RemoteOperate/Views/SkillTabPickerView.swift
  ChainlessChain/Features/RemoteOperate/Views/SystemInfoView.swift

  ChainlessChain/Features/Common/Services/PushNotificationManager+RemoteTarget.swift
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

  # Walk/create the group hierarchy mirroring the on-disk folder structure.
  # find_subpath(true) creates groups as needed; passing nil parent means
  # start from project.main_group.
  parent_dir = File.dirname(rel) # e.g. "ChainlessChain/Features/Pairing/Views"
  group = project.main_group.find_subpath(parent_dir, true)
  group.set_source_tree('<group>')

  # Create file reference. Use path relative to the group's source tree.
  file_ref = group.new_reference(basename)
  file_ref.set_source_tree('<group>')
  file_ref.set_explicit_file_type(nil) # let Xcode infer from extension
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
