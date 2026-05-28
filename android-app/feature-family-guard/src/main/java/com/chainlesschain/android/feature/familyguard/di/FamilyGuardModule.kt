package com.chainlesschain.android.feature.familyguard.di

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Hilt graph entry for :feature-family-guard.
 *
 * FAMILY-01 scaffold: empty module that proves Hilt wiring at module level.
 * Real bindings (FamilyGroupRepository, FamilyPermissionChecker, TimeAuthority,
 * etc.) join in FAMILY-10..67 — each ticket adds its own @Provides here or a
 * dedicated sub-module under the same `.di` package.
 */
@Module
@InstallIn(SingletonComponent::class)
object FamilyGuardModule
