-- 抖音 IM 数据库 schema（com.ss.android.ugc.aweme）
-- 抖音有两套 IM 库：
--  (A) 经典 ByteDance IM（WCDB，mi_pigeon_*_im.db / encrypted_<uid>_im.db）— 与头条同 schema
--  (B) 新版 Room IM（im_database_，im_message/im_conversation）
-- 源：真机明文库；加密主库 SQLCipher 需 frida 截 key 解密。提取 2026-06-17，仅结构。

-- ============================================================
-- (A) 抖音经典 ByteDance IM（mi_pigeon / 同 encrypted_im 主库）
-- ============================================================

CREATE TABLE attchment (uuid TEXT NOT NULL,local_uri TEXT,remote_uri TEXT,size BIGINT,type TEXT,hash TEXT,position INTEGER,status INTEGER,ext TEXT,display_type TEXT,mime_type TEXT);

CREATE TABLE conversation_core (conversation_id TEXT PRIMARY KEY,info_version BIGINT,name TEXT,desc TEXT,icon TEXT,notice TEXT,owner_id INTEGER DEFAULT -1,sec_owner TEXT,silent INTEGER DEFAULT 0,silent_normal_only INTEGER DEFAULT 0,mode INTEGER DEFAULT -1,ext TEXT,creator_uid INTEGER DEFAULT -1,create_time INTEGER,silent_source INTEGER DEFAULT 0,silent_util_time INTEGER DEFAULT 0);

CREATE TABLE conversation_kv(conv_id TEXT,key TEXT,value TEXT,primary key(conv_id,key));

CREATE TABLE conversation_list (conversation_id TEXT PRIMARY KEY,short_id BIGINT,type INTEGER,last_msg_index BIGINT,updated_time INTEGER,unread_count INTEGER,read_index BIGINT,inbox INTEGER,min_index BIGINT,drafted_time INTEGER,ticket TEXT,draft_content TEXT,local_info TEXT,is_member INTEGER,has_more INTEGER,member_count INTEGER,status INTEGER,participant TEXT,last_msg_order_index BIGINT,stranger INTEGER default 0,sort_order INTEGER,min_index_v2 BIGINT,max_index_v2 BIGINT,read_index_v2 BIGINT,badge_count INTEGER,read_badge_count INTEGER,is_in_box INTEGER DEFAULT 0,sub_conversation_short_id BIGINT,server_max_index_v2 BIGINT DEFAULT -1,last_show_msg_uuid TEXT);

CREATE TABLE conversation_setting (conversation_id TEXT PRIMARY KEY,info_version BIGINT,stick_top INTEGER,mute INTEGER,ext TEXT,favor INTEGER);

CREATE TABLE conversation_sub_info (short_id BIGINT PRIMARY KEY,conversation_id TEXT,parent_conversation_id TEXT,parent_short_id BIGINT,conversation_type INTEGER,status INTEGER,biz_status TEXT,create_time BIGINT,modify_time  BIGINT,ext TEXT,inbox_type INTEGER,version  BIGINT);

CREATE TABLE conversation_unreadcount (conversation_id TEXT,type INTEGER,read_badge_count INTEGER,badge_count INTEGER);

CREATE TABLE mention(uuid TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,ids_str TEXT,sender_id BIGINT,created_time INTEGER);

CREATE TABLE message_kv(uuid TEXT,key TEXT,value TEXT,primary key(uuid,key));

CREATE TABLE msg(msg_uuid TEXT PRIMARY KEY,msg_server_id BIGINT,conversation_id TEXT NOT NULL,conversation_short_id BIGINT,conversation_type INTEGER,type INTEGER,index_in_conversation BIGINT,order_index BIGINT,status INTEGER,net_status INTEGER,version INTEGER,deleted INTEGER,created_time INTEGER,sender BIGINT,content TEXT,ext TEXT,local_info TEXT,read_status INTEGER,sec_sender TEXT,property_list TEXT,index_in_conversation_v2 BIGINT default -1,table_flag BIGINT default 0,sub_conversation_short_id BIGINT);

CREATE TABLE msg_property_new(msg_uuid TEXT,conversation_id TEXT NOT NULL,key TEXT,idempotent_id TEXT,sender INTEGER,sender_sec TEXT,create_time INTEGER,value TEXT,deleted INTEGER,version INTEGER,status INTEGER,PRIMARY KEY(msg_uuid,key,idempotent_id));

CREATE TABLE participant(user_id INTEGER NOT NULL,sort_order INTEGER,role INTEGER,conversation_id TEXT,alias TEXT,sec_uid TEXT,silent INTEGER,silent_time INTEGER,biz_role TEXT);

CREATE TABLE participant_read(user_id INTEGER NOT NULL,conversation_id TEXT,min_index INTEGER,read_index INTEGER,read_order INTEGER);

CREATE TABLE share_merge_msg(msg_id BIGINT,card_conversation_id TEXT,msg_data TEXT,created_time INTEGER,request_time INTEGER,primary key(msg_id,card_conversation_id));

CREATE INDEX CONVERSATION_INDEX ON msg(conversation_id,index_in_conversation);

CREATE INDEX MEMBER_CONVERSATION_INDEX on participant(conversation_id);

CREATE INDEX MSG_UUID_INDEX ON msg(msg_uuid);

CREATE INDEX UID_INDEX ON msg(msg_server_id);

CREATE INDEX UNREADCOUNT_CONV_ID_INDEX ON conversation_unreadcount(conversation_id);

CREATE INDEX UNREADCOUNT_CONV_ID_UNION_INDEX ON conversation_unreadcount(conversation_id,type);

CREATE INDEX USER_ID_INDEX on participant(user_id);

CREATE INDEX attchment_index on attchment(uuid);

CREATE INDEX id_index on conversation_kv(conv_id);

CREATE INDEX msg_ky_id_index on message_kv(uuid);

CREATE INDEX msg_ky_key_index on message_kv(key);

-- ============================================================
-- (B) 抖音新版 Room IM（im_database_）
-- ============================================================

CREATE VIRTUAL TABLE `fts_im_conversation` USING FTS4(`conversation_id` TEXT NOT NULL, `name` TEXT, `bot_type` INTEGER NOT NULL, `is_local` INTEGER, `conversation_type` INTEGER, tokenize=mmicu, content=`im_conversation`);

CREATE TABLE 'fts_im_conversation_docsize'(docid INTEGER PRIMARY KEY, size BLOB);

CREATE TABLE 'fts_im_conversation_segdir'(level INTEGER,idx INTEGER,start_block INTEGER,leaves_end_block INTEGER,end_block INTEGER,root BLOB,PRIMARY KEY(level, idx));

CREATE TABLE 'fts_im_conversation_segments'(blockid INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'fts_im_conversation_stat'(id INTEGER PRIMARY KEY, value BLOB);

CREATE VIRTUAL TABLE `fts_im_message` USING FTS4(`local_message_id` TEXT NOT NULL, `message_id` TEXT, `fts_content` TEXT, `conversation_id` TEXT, `local_index` INTEGER NOT NULL, tokenize=mmicu, content=`im_message`);

CREATE TABLE 'fts_im_message_docsize'(docid INTEGER PRIMARY KEY, size BLOB);

CREATE TABLE 'fts_im_message_segdir'(level INTEGER,idx INTEGER,start_block INTEGER,leaves_end_block INTEGER,end_block INTEGER,root BLOB,PRIMARY KEY(level, idx));

CREATE TABLE 'fts_im_message_segments'(blockid INTEGER PRIMARY KEY, block BLOB);

CREATE TABLE 'fts_im_message_stat'(id INTEGER PRIMARY KEY, value BLOB);

CREATE TABLE `im_bot` (`bot_id` TEXT NOT NULL, `name` TEXT, `icon_image` TEXT, `create_time` INTEGER NOT NULL, `update_time` INTEGER, `bot_type` INTEGER, `share_info` TEXT, `creator_info` TEXT, `show_tag_info_list` TEXT, `select_text_actions` TEXT, `private_status` INTEGER, `conversation_page` TEXT, `description_for_model` TEXT, `description_for_human` TEXT, `bot_status` INTEGER, `status` INTEGER, `model` TEXT, `voice_type` TEXT, `edit_pos` TEXT, `muted` INTEGER NOT NULL, `recommend_index` INTEGER, `message_push` INTEGER, `show_message_push` INTEGER, `bio` TEXT, `user_edit_bio` TEXT, `bot_stats` TEXT, `answer_actions` TEXT, `hover_answer_actions` TEXT, `streaming_answer_actions` TEXT, `bot_conf` TEXT, `bot_mode` INTEGER NOT NULL, `bg_img_url` TEXT, `bg_img_avg_hue` TEXT, `bg_video_model` TEXT, `icon_prompt` TEXT, `enable_web_search` INTEGER, `enable_pic_gen` INTEGER, `caller_name` TEXT, `caller_name_setting` INTEGER, `digital_human_data` TEXT, `call_model_list` TEXT, `first_met` TEXT, `camera_tab_config_map` TEXT, `bot_feature_label` TEXT, `onboarding` TEXT, `bg_img_uri` TEXT, `bg_img_info` TEXT, `user_bot_gender_starling_key` TEXT, `user_bot_type_starling_key` TEXT, `bot_memory_config` TEXT, `phone_call_img` TEXT, `bot_icon_mapped_app_icon` TEXT, `dynamic_img_uri` TEXT, `dynamic_img_url` TEXT, `message_push_switch_confirm_title` TEXT, `msg_regen_mode_list` TEXT, `unavailable_instruction_type_list` TEXT, `loading_conf` TEXT, `like_info_show` INTEGER, `like_info_liked` INTEGER, `like_info_count` INTEGER, `like_info_count_l` INTEGER, `bot_comment_info_show` INTEGER, `bot_comment_info_count` INTEGER, `bot_comment_info_count_l` INTEGER, `extra` TEXT, PRIMARY KEY(`bot_id`));

CREATE TABLE `im_conversation` (`conversation_id` TEXT NOT NULL, `bot_type` INTEGER NOT NULL, `icon_image` TEXT, `name` TEXT, `tags` TEXT, `update_time` INTEGER, `pinned` INTEGER, `is_local` INTEGER, `conversation_page` TEXT, `templates` TEXT, `message_cursor` INTEGER, `tts_enable` INTEGER NOT NULL, `conversation_type` INTEGER, `participant_count` INTEGER, `badge_count` INTEGER, `read_badge_count` INTEGER, `brief_message_local_id` TEXT, `read_message_index` INTEGER, `ext` TEXT, `biz_model` TEXT, `version` INTEGER, `status` INTEGER, `biz_extra` TEXT, `retention_cursor` INTEGER, `latest_message_index` INTEGER, `group_owner_id` TEXT, `is_deleted` INTEGER NOT NULL, `trace_map` TEXT, `input_left_button_style` INTEGER, `group_review_status` INTEGER, `create_scene` INTEGER, `cell_type` INTEGER, `create_channel` INTEGER, `parent_cell_id` TEXT, PRIMARY KEY(`conversation_id`));

CREATE TABLE `im_message` (`local_message_id` TEXT NOT NULL, `message_id` TEXT, `section_id` TEXT, `section_name` TEXT, `server_index` INTEGER, `create_time` INTEGER NOT NULL, `content_type` INTEGER NOT NULL, `status` INTEGER NOT NULL, `message_status` INTEGER NOT NULL, `regen_msg_list` TEXT, `regen_root_id` TEXT, `regen_index` INTEGER, `regen_status` INTEGER NOT NULL, `regen_visible` INTEGER NOT NULL, `sender_id` TEXT, `brief` TEXT, `content` TEXT, `thinking_content` TEXT, `fts_content` TEXT, `ext` TEXT, `conversation_id` TEXT, `feedback` INTEGER, `local_index` INTEGER NOT NULL, `reference_info` TEXT, `source_from_asr` INTEGER NOT NULL, `image_data_path` TEXT, `image_upload_status` INTEGER NOT NULL, `audio_url` TEXT, `audio_duration` INTEGER NOT NULL, `suggest_questions` TEXT, `user_type` INTEGER NOT NULL, `message_body_version` INTEGER, `tags` TEXT, `content_status` INTEGER, `reply_id` TEXT, `biz_content_type` TEXT, `biz_extra` TEXT, `time_group_id` INTEGER NOT NULL, `sub_list` TEXT, `sub_list_group` TEXT, PRIMARY KEY(`local_message_id`));

CREATE TABLE `im_participant` (`participant_id` TEXT NOT NULL, `conversation_id` TEXT NOT NULL, `sort_order` INTEGER, `type` INTEGER, `role` INTEGER, `name` TEXT, `icon_image` TEXT, `voice_type` TEXT, `ext` TEXT, `desc` TEXT, `is_voice_muted` INTEGER, `status` INTEGER NOT NULL, `can_not_interact_with` INTEGER, PRIMARY KEY(`participant_id`, `conversation_id`));

CREATE TABLE room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT);

CREATE UNIQUE INDEX `index_im_bot_bot_id` ON `im_bot` (`bot_id`);

CREATE UNIQUE INDEX `index_im_conversation_conversation_id` ON `im_conversation` (`conversation_id`);

CREATE INDEX `index_im_message_conversation_id` ON `im_message` (`conversation_id`);

CREATE INDEX `index_im_participant_conversation_id` ON `im_participant` (`conversation_id`);

CREATE TRIGGER room_fts_content_sync_fts_im_conversation_AFTER_INSERT AFTER INSERT ON `im_conversation` BEGIN INSERT INTO `fts_im_conversation`(`docid`, `conversation_id`, `name`, `bot_type`, `is_local`, `conversation_type`) VALUES (NEW.`rowid`, NEW.`conversation_id`, NEW.`name`, NEW.`bot_type`, NEW.`is_local`, NEW.`conversation_type`); END;

CREATE TRIGGER room_fts_content_sync_fts_im_conversation_AFTER_UPDATE AFTER UPDATE ON `im_conversation` BEGIN INSERT INTO `fts_im_conversation`(`docid`, `conversation_id`, `name`, `bot_type`, `is_local`, `conversation_type`) VALUES (NEW.`rowid`, NEW.`conversation_id`, NEW.`name`, NEW.`bot_type`, NEW.`is_local`, NEW.`conversation_type`); END;

CREATE TRIGGER room_fts_content_sync_fts_im_conversation_BEFORE_DELETE BEFORE DELETE ON `im_conversation` BEGIN DELETE FROM `fts_im_conversation` WHERE `docid`=OLD.`rowid`; END;

CREATE TRIGGER room_fts_content_sync_fts_im_conversation_BEFORE_UPDATE BEFORE UPDATE ON `im_conversation` BEGIN DELETE FROM `fts_im_conversation` WHERE `docid`=OLD.`rowid`; END;

CREATE TRIGGER room_fts_content_sync_fts_im_message_AFTER_INSERT AFTER INSERT ON `im_message` BEGIN INSERT INTO `fts_im_message`(`docid`, `local_message_id`, `message_id`, `fts_content`, `conversation_id`, `local_index`) VALUES (NEW.`rowid`, NEW.`local_message_id`, NEW.`message_id`, NEW.`fts_content`, NEW.`conversation_id`, NEW.`local_index`); END;

CREATE TRIGGER room_fts_content_sync_fts_im_message_AFTER_UPDATE AFTER UPDATE ON `im_message` BEGIN INSERT INTO `fts_im_message`(`docid`, `local_message_id`, `message_id`, `fts_content`, `conversation_id`, `local_index`) VALUES (NEW.`rowid`, NEW.`local_message_id`, NEW.`message_id`, NEW.`fts_content`, NEW.`conversation_id`, NEW.`local_index`); END;

CREATE TRIGGER room_fts_content_sync_fts_im_message_BEFORE_DELETE BEFORE DELETE ON `im_message` BEGIN DELETE FROM `fts_im_message` WHERE `docid`=OLD.`rowid`; END;

CREATE TRIGGER room_fts_content_sync_fts_im_message_BEFORE_UPDATE BEFORE UPDATE ON `im_message` BEGIN DELETE FROM `fts_im_message` WHERE `docid`=OLD.`rowid`; END;

