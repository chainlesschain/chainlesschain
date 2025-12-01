package com.chainlesschain.database;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import com.chainlesschain.model.ChatMessage;
import com.chainlesschain.model.KnowledgeItem;

import net.sqlcipher.database.SQLiteDatabase;
import net.sqlcipher.database.SupportFactory;

/**
 * App Database
 * 应用数据库（加密）
 */
@Database(entities = {KnowledgeItem.class, ChatMessage.class}, version = 1, exportSchema = false)
public abstract class AppDatabase extends RoomDatabase {

    private static volatile AppDatabase INSTANCE;
    private static final String DB_NAME = "chainlesschain.db";

    public abstract KnowledgeDao knowledgeDao();
    public abstract ChatDao chatDao();

    public static AppDatabase getInstance(Context context, String password) {
        if (INSTANCE == null) {
            synchronized (AppDatabase.class) {
                if (INSTANCE == null) {
                    // Initialize SQLCipher
                    System.loadLibrary("sqlcipher");

                    // Create encrypted database
                    byte[] passphrase = SQLiteDatabase.getBytes(password.toCharArray());
                    SupportFactory factory = new SupportFactory(passphrase);

                    INSTANCE = Room.databaseBuilder(
                            context.getApplicationContext(),
                            AppDatabase.class,
                            DB_NAME)
                            .openHelperFactory(factory)
                            .fallbackToDestructiveMigration()
                            .build();
                }
            }
        }
        return INSTANCE;
    }

    public static void destroyInstance() {
        INSTANCE = null;
    }
}
