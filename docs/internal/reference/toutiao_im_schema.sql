-- 今日头条 IM 数据库 schema（com.ss.android.article.news）
-- 源：真机明文旧账号库 <uid>_im.db（ByteDance com.ss.android.im 框架，与抖音 mi_pigeon 同套）
-- 加密主库 encrypted_<uid>_im.db 同此 schema（SQLCipher，需 frida 截 key 解密）
-- 提取 2026-06-17，仅结构（CREATE 语句），无数据。

-- ============================================================
-- toutiao classic IM
-- ============================================================

CREATE TABLE attchment (uuid TEXT NOT NULL,local_uri TEXT,remote_uri TEXT,size BIGINT,type TEXT,hash TEXT,position INTEGER,status INTEGER,ext TEXT,display_type TEXT,mime_type TEXT,upload_uri TEXT);

CREATE TABLE conversation_core (conversation_id TEXT PRIMARY KEY,info_version BIGINT,name TEXT,desc TEXT,icon TEXT,notice TEXT,owner_id INTEGER DEFAULT -1,sec_owner TEXT,silent INTEGER DEFAULT 0,silent_normal_only INTEGER DEFAULT 0,mode INTEGER DEFAULT -1,ext TEXT);

CREATE TABLE conversation_kv(conv_id TEXT,key TEXT,value TEXT,primary key(conv_id,key));

CREATE TABLE conversation_list (conversation_id TEXT PRIMARY KEY,short_id BIGINT,type INTEGER,last_msg_index BIGINT,updated_time INTEGER,unread_count INTEGER,read_index BIGINT,inbox INTEGER,min_index BIGINT,drafted_time INTEGER,ticket TEXT,draft_content TEXT,local_info TEXT,is_member INTEGER,has_more INTEGER,member_count INTEGER,status INTEGER,participant TEXT,last_msg_order_index BIGINT,stranger INTEGER default 0,sort_order INTEGER,min_index_v2 BIGINT,max_index_v2 BIGINT,read_index_v2 BIGINT,badge_count INTEGER,read_badge_count INTEGER,is_in_box INTEGER DEFAULT 0,unread_count_wl INTEGER DEFAULT 0);

CREATE TABLE conversation_setting (conversation_id TEXT PRIMARY KEY,info_version BIGINT,stick_top INTEGER,mute INTEGER,ext TEXT,favor INTEGER,set_top_time BIGINT,set_favorite_time BIGINT,push_status INTEGER DEFAULT 1);

CREATE TABLE conversation_tag(conv_id TEXT,tag_id INTEGER,tag_type INTEGER);

CREATE TABLE mention(uuid TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,ids_str TEXT,sender_id BIGINT,created_time INTEGER);

CREATE TABLE message_kv(uuid TEXT,key TEXT,value TEXT,primary key(uuid,key));

CREATE TABLE msg(msg_uuid TEXT PRIMARY KEY,msg_server_id BIGINT,conversation_id TEXT NOT NULL,conversation_short_id BIGINT,conversation_type INTEGER,type INTEGER,index_in_conversation BIGINT,order_index BIGINT,status INTEGER,net_status INTEGER,version INTEGER,deleted INTEGER,created_time INTEGER,sender BIGINT,content TEXT,ext TEXT,local_info TEXT,read_status INTEGER,sec_sender TEXT,property_list TEXT,index_in_conversation_v2 BIGINT default -1,table_flag BIGINT default 0);

CREATE TABLE msg_property_new(msg_uuid TEXT,conversation_id TEXT NOT NULL,key TEXT,idempotent_id TEXT,sender INTEGER,sender_sec TEXT,create_time INTEGER,value TEXT,deleted INTEGER,version INTEGER,status INTEGER,PRIMARY KEY(msg_uuid,key,idempotent_id));

CREATE TABLE participant(user_id INTEGER NOT NULL,sort_order INTEGER,role INTEGER,conversation_id TEXT,alias TEXT,sec_uid TEXT,silent INTEGER,silent_time INTEGER,ext TEXT);

CREATE TABLE participant_read(user_id INTEGER NOT NULL,conversation_id TEXT,min_index INTEGER,read_index INTEGER,read_order INTEGER);

CREATE INDEX CONVERSATION_INDEX ON msg(conversation_id,index_in_conversation);

CREATE INDEX MEMBER_CONVERSATION_INDEX on participant(conversation_id);

CREATE INDEX MSG_UUID_INDEX ON msg(msg_uuid);

CREATE INDEX UID_INDEX ON msg(msg_server_id);

CREATE INDEX USER_ID_INDEX on participant(user_id);

CREATE INDEX attchment_index on attchment(uuid);

CREATE INDEX conv_tag_id_index ON conversation_tag( conv_id, tag_id );

CREATE INDEX id_index on conversation_kv(conv_id);

CREATE INDEX msg_ky_id_index on message_kv(uuid);

CREATE INDEX msg_ky_key_index on message_kv(key);

