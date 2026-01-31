package com.chainlesschain.android.remote.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

/**
 * 命令历史数据库
 */
@Database(
    entities = [
        CommandHistoryEntity::class,
        FileTransferEntity::class
    ],
    version = 2, // 增加版本号
    exportSchema = false
)
@TypeConverters(Converters::class, FileTransferConverters::class)
abstract class CommandHistoryDatabase : RoomDatabase() {

    abstract fun commandHistoryDao(): CommandHistoryDao
    abstract fun fileTransferDao(): FileTransferDao

    companion object {
        @Volatile
        private var INSTANCE: CommandHistoryDatabase? = null

        fun getDatabase(context: Context): CommandHistoryDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    CommandHistoryDatabase::class.java,
                    "command_history_database"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
