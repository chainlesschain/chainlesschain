#!/usr/bin/env ruby
# frozen_string_literal: true

# Wire 5 local SPM library products from ios-app/Package.swift into the
# ChainlessChain app target's framework dependencies.
#
# Idempotent — detects existing wiring and skips. Run from ios-app/ directory:
#   gem install xcodeproj
#   ruby scripts/wire_spm_packages.rb
#
# Triggered via .github/workflows/ios-wire-spm.yml (workflow_dispatch).

require 'xcodeproj'

PROJECT_PATH = 'ChainlessChain.xcodeproj'
APP_TARGET   = 'ChainlessChain'
PRODUCTS     = %w[CoreCommon CoreSecurity CoreDID CoreE2EE CoreP2P].freeze

abort "❌ Package.swift not found at #{Dir.pwd}/Package.swift — run from ios-app/" unless File.exist?('Package.swift')
abort "❌ #{PROJECT_PATH} not found — run from ios-app/" unless File.exist?(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
target  = project.targets.find { |t| t.name == APP_TARGET }
abort "❌ Target '#{APP_TARGET}' not found in #{PROJECT_PATH}" unless target

# ─── 1. XCLocalSwiftPackageReference (Package.swift @ same dir) ────────────
package_refs = project.root_object.package_references.to_a
local_ref = package_refs.find do |ref|
  ref.is_a?(Xcodeproj::Project::Object::XCLocalSwiftPackageReference) &&
    ref.respond_to?(:relative_path) &&
    (ref.relative_path == '.' || ref.relative_path == '..')
end

if local_ref
  puts "↻ XCLocalSwiftPackageReference for '#{local_ref.relative_path}' already exists (#{local_ref.uuid})"
else
  local_ref = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  local_ref.relative_path = '.'
  project.root_object.package_references << local_ref
  puts "✓ Added XCLocalSwiftPackageReference (relative_path='.', uuid=#{local_ref.uuid})"
end

# ─── 2. Per-product XCSwiftPackageProductDependency + FrameworksPhase entry ──
added_count   = 0
skipped_count = 0

PRODUCTS.each do |product_name|
  existing_dep = target.package_product_dependencies.find { |d| d.product_name == product_name }
  if existing_dep
    puts "↻ #{product_name}: already wired (dep #{existing_dep.uuid})"
    skipped_count += 1
    next
  end

  dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dep.product_name = product_name
  dep.package = local_ref
  target.package_product_dependencies << dep

  bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.product_ref = dep
  target.frameworks_build_phase.files << bf

  puts "✓ Wired #{product_name} (dep #{dep.uuid}, buildfile #{bf.uuid})"
  added_count += 1
end

project.save

puts ''
puts '═══════════════════════════════════════════════════'
puts "Summary: #{added_count} newly wired, #{skipped_count} already present"
puts '═══════════════════════════════════════════════════'

if added_count.zero?
  puts "ℹ️  No changes — project.pbxproj untouched"
  exit 0
end

puts "ℹ️  project.pbxproj modified — review diff & commit:"
puts "    git diff #{PROJECT_PATH}/project.pbxproj"
