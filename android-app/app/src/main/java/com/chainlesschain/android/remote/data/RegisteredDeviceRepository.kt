package com.chainlesschain.android.remote.data

import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RegisteredDeviceRepository @Inject constructor(
    database: CommandHistoryDatabase
) {
    private val dao = database.registeredDeviceDao()

    fun getDevicesFlow(): Flow<List<RegisteredDeviceEntity>> = dao.getAllFlow()

    suspend fun registerOrUpdate(
        peerId: String,
        did: String,
        deviceName: String,
        ipAddress: String
    ) {
        val existing = dao.getByPeerId(peerId)
        val now = System.currentTimeMillis()
        dao.upsert(
            RegisteredDeviceEntity(
                peerId = peerId,
                did = did,
                deviceName = deviceName,
                ipAddress = ipAddress,
                createdAt = existing?.createdAt ?: now,
                lastSeenAt = now
            )
        )
    }

    suspend fun isRegistered(peerId: String): Boolean = dao.getByPeerId(peerId) != null

    suspend fun remove(peerId: String) {
        dao.deleteByPeerId(peerId)
    }
}
