#!/usr/bin/env ruby
# frozen_string_literal: true

# ChainlessChain iOS Xcode Project Generator
#
# This script automatically generates an Xcode project file (.xcodeproj)
# for the ChainlessChain iOS application.
#
# Requirements:
#   gem install xcodeproj
#
# Usage:
#   ruby create_xcode_project.rb

require 'xcodeproj'
require 'fileutils'

# Configuration
PROJECT_NAME = 'ChainlessChain'
BUNDLE_ID = 'com.chainlesschain.ChainlessChain'
DEPLOYMENT_TARGET = '15.0'
SWIFT_VERSION = '5.0'
PROJECT_DIR = File.dirname(__FILE__)

puts "🚀 Creating Xcode project for #{PROJECT_NAME}..."

# Create project
project = Xcodeproj::Project.new("#{PROJECT_DIR}/#{PROJECT_NAME}.xcodeproj")

# Create main target
target = project.new_target(:application, PROJECT_NAME, :ios, DEPLOYMENT_TARGET)

# Configure build settings
target.build_configurations.each do |config|
  config.build_settings['PRODUCT_NAME'] = PROJECT_NAME
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  config.build_settings['SWIFT_VERSION'] = SWIFT_VERSION
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2' # iPhone and iPad
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  config.build_settings['ENABLE_BITCODE'] = 'NO' # WebRTC doesn't support bitcode
  config.build_settings['INFOPLIST_FILE'] = 'ChainlessChain/Resources/Info.plist'
  config.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  config.build_settings['DEVELOPMENT_TEAM'] = '' # User needs to set this

  # Swift flags
  if config.name == 'Debug'
    config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG'
    config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
  else
    config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-O'
  end

  # Linker flags for SQLCipher
  config.build_settings['OTHER_LDFLAGS'] = '-lsqlite3 -lc++'
end

# Add source files
def add_files_recursively(group, path, target, project)
  Dir.glob("#{path}/*").each do |file|
    next if File.basename(file).start_with?('.')

    if File.directory?(file)
      # Create group for directory
      subgroup = group.new_group(File.basename(file))
      add_files_recursively(subgroup, file, target, project)
    elsif file.end_with?('.swift')
      # Add Swift file
      file_ref = group.new_file(file)
      target.add_file_references([file_ref])
    elsif file.end_with?('.plist', '.xcassets', '.storyboard', '.xib')
      # Add resource file
      file_ref = group.new_file(file)
      target.resources_build_phase.add_file_reference(file_ref)
    end
  end
end

puts "📁 Adding source files..."

# Create main group structure
app_group = project.main_group.new_group('ChainlessChain')
modules_group = project.main_group.new_group('Modules')

# Add ChainlessChain app files
%w[App Features Data Core Resources].each do |folder|
  folder_path = "#{PROJECT_DIR}/ChainlessChain/#{folder}"
  if Dir.exist?(folder_path)
    puts "  Adding #{folder}..."
    add_files_recursively(app_group, folder_path, target, project)
  end
end

# Add Swift Package dependencies
puts "📦 Configuring Swift Package dependencies..."

# Note: Swift Package dependencies need to be added manually in Xcode
# or via Package.resolved file. This script creates the project structure.

# Add local packages (Modules)
%w[CoreCommon CoreSecurity CoreDatabase CoreDID CoreE2EE CoreP2P].each do |module_name|
  module_path = "#{PROJECT_DIR}/Modules/#{module_name}"
  if Dir.exist?(module_path)
    puts "  Linking #{module_name}..."
    # Local packages are referenced via Package.swift
  end
end

# Configure schemes
puts "⚙️  Configuring schemes..."

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project.path, PROJECT_NAME)

# Save project
puts "💾 Saving project..."
project.save

puts "✅ Xcode project created successfully!"
puts ""
puts "📋 Next steps:"
puts "  1. Open #{PROJECT_NAME}.xcodeproj in Xcode"
puts "  2. Select your development team in Signing & Capabilities"
puts "  3. Add Swift Package dependencies:"
puts "     - File → Add Packages..."
puts "     - Add the following URLs:"
puts "       • https://github.com/signalapp/libsignal.git"
puts "       • https://github.com/sqlcipher/sqlcipher.git"
puts "       • https://github.com/stasel/WebRTC.git"
puts "       • https://github.com/daltoniam/Starscream.git"
puts "       • https://github.com/krzyzanowskim/CryptoSwift.git"
puts "       • https://github.com/Flight-School/AnyCodable.git"
puts "  4. Add local packages (Modules) as needed"
puts "  5. Build and run (Cmd+R)"
puts ""
puts "📖 For detailed instructions, see XCODE_PROJECT_SETUP.md"
