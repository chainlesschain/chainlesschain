-- ============================================================
-- 微信数据库表结构 (WeChat Database Schema)
-- 数据库: EnMicroMsg.db
-- 表数量: 258
-- ============================================================

-- 目录 (Table of Contents)
-- --------------------------------------------------------
--   1. AAPayRecord                              -- 支付/钱包相关表
--   2. AARecord
--   3. ABTestInfo                               -- AB测试相关表
--   4. ABTestItem                               -- AB测试相关表
--   5. ActiveInfo
--   6. AddContactAntispamTicket                 -- 联系人相关表
--   7. ApkChannelPatchInfo
--   8. AppInfo
--   9. AppMessage                               -- 应用消息表 - 存储小程序/链接等消息
--  10. AppSort
--  11. BackupMoveTime                           -- 备份相关表
--  12. BackupRecoverMsgListDataId               -- 消息相关表
--  13. BackupTempMoveTime                       -- 备份相关表
--  14. BizAdInfo                                -- 公众号/企业号相关表
--  15. BizAppMsgReportContext                   -- 消息相关表
--  16. BizBlockFinderInfo                       -- 公众号/企业号相关表
--  17. BizChatConversation                      -- 公众号/企业号相关表
--  18. BizChatInfo                              -- 公众号/企业号相关表
--  19. BizChatMyUserInfo                        -- 公众号/企业号相关表
--  20. BizChatUserInfo                          -- 公众号/企业号相关表
--  21. BizContactConversationMassSend           -- 联系人相关表
--  22. BizEnterprise                            -- 公众号/企业号相关表
--  23. BizFollowedContactDigest                 -- 联系人相关表
--  24. BizKF                                    -- 公众号/企业号相关表
--  25. BizPhotoSingleMsgInfo                    -- 消息相关表
--  26. BizRecExposeInfo                         -- 公众号/企业号相关表
--  27. BizScreenshotInfo                        -- 公众号/企业号相关表
--  28. BizTimeLineInfo                          -- 公众号/企业号相关表
--  29. BizTimeLineSingleMsgInfo                 -- 消息相关表
--  30. CardMsgInfo                              -- 消息相关表
--  31. CardQrCodeConfi
--  32. CardQrCodeDataInfo
--  33. CdnDownloadInfo
--  34. ChatBotConfig
--  35. ChatroomMsgSeq                           -- 消息相关表
--  36. ChatroomNoticeAttachIndex                -- 群聊相关表
--  37. CleanDeleteItem
--  38. ContactCmdBuf                            -- 联系人相关表
--  39. ContactLabel                             -- 联系人标签表
--  40. ContactLabelCache                        -- 联系人相关表
--  41. DelayTransferRecord
--  42. DeletedConversationInfo
--  43. DownloadTaskItem
--  44. EmojiDesignerProduct                     -- 表情相关表
--  45. EmojiGroupInfo                           -- 表情相关表
--  46. EmojiIPSetInfo                           -- 表情相关表
--  47. EmojiInfo                                -- 表情信息表
--  48. EmojiInfoDesc                            -- 表情相关表
--  49. EmojiSuggestCacheInfo                    -- 表情相关表
--  50. EmojiSuggestDescInfo                     -- 表情相关表
--  51. EmotionDesignerInfo
--  52. EmotionDetailInfo
--  53. EmotionRewardInfo
--  54. EmotionRewardTipInfo
--  55. FavOffline                               -- 收藏相关表
--  56. FileDownloadInfo
--  57. FileMsgInfo                              -- 消息相关表
--  58. ForceNotifyData
--  59. FriendUser
--  60. FunctionMsgItem                          -- 消息相关表
--  61. GameChatRoomContact                      -- 联系人相关表
--  62. GameHaowanMedia                          -- 游戏相关表
--  63. GameHaowanPublishEdition                 -- 游戏相关表
--  64. GameLifeContact                          -- 联系人相关表
--  65. GameLifeConversation                     -- 游戏相关表
--  66. GameLifeSessionInfo                      -- 游戏相关表
--  67. GameLocalVideoInfo                       -- 视频相关表
--  68. GameMsgPullRecord                        -- 消息相关表
--  69. GameMsgRelativeContent                   -- 消息相关表
--  70. GamePBCache                              -- 游戏相关表
--  71. GameRawMessage                           -- 游戏原始消息表
--  72. GameResourceDownload                     -- 游戏相关表
--  73. GameSilentDownload                       -- 游戏相关表
--  74. GameSimpleUserInfo                       -- 游戏相关表
--  75. GetEmotionListCache
--  76. GetEmotionStoreRecListCache
--  77. GetSysCmdMsgInfo                         -- 消息相关表
--  78. GoogleFriend
--  79. GroupBindApp
--  80. GroupSolitatire
--  81. GroupTodo
--  82. GroupTools
--  83. HardDeviceChampionInfo
--  84. HardDeviceInfo                           -- 硬件设备信息表
--  85. HardDeviceLikeUser
--  86. HardDeviceProfileRankDetail
--  87. HardDeviceRankFollowInfo
--  88. HardDeviceRankInfo
--  89. HardIotCdnInfo
--  90. HardIotDeviceInfo
--  91. HoneyPayMsgRecord                        -- 消息相关表
--  92. ILinkResourceInfo
--  93. IPCallAddressItem
--  94. IPCallMsg                                -- 消息相关表
--  95. IPCallPopularCountry
--  96. IPCallRecord
--  97. ImgInfo                                  -- 图片相关表
--  98. ImgInfo2                                 -- 图片信息表 - 存储图片消息详情
--  99. JsLogBlockList
-- 100. KindaCacheTable                          -- AB测试相关表
-- 101. LBSVerifyMessage                         -- 消息相关表
-- 102. LabAppInfo                               -- AB测试相关表
-- 103. LiteAppAuthInfo
-- 104. LiteAppBaselibInfo
-- 105. LiteAppConfigInfo
-- 106. LiteAppInfo
-- 107. LiveTipsBar
-- 108. LoanEntryInfo
-- 109. LocalGameReport                          -- 游戏相关表
-- 110. LocalLiteAppConf
-- 111. LocalRedPacketStoryInfo
-- 112. LocalStoryDetail
-- 113. LuckyMoneyDetailOpenRecord
-- 114. LuckyMoneyEnvelopeResource
-- 115. MagicPkgInfo
-- 116. MediaDuplication
-- 117. MsgQuote                                 -- 消息相关表
-- 118. MultiTalkInfo
-- 119. MultiTalkMember
-- 120. MultiTaskInfo
-- 121. Music
-- 122. NewTipsInfo
-- 123. NewTipsInfo2
-- 124. NotifyMessageRecord                      -- 消息相关表
-- 125. OfflineOrderStatus
-- 126. OldAccountFriend
-- 127. OpenIMAccTypeInfo
-- 128. OpenIMAppIdInfo
-- 129. OpenIMArchive
-- 130. OpenIMFinderInfoNew
-- 131. OpenIMKefuContact                        -- 联系人相关表
-- 132. OpenIMSnsFlag                            -- 朋友圈相关表
-- 133. OpenIMWordingInfo
-- 134. OpenMsgListener                          -- 消息相关表
-- 135. OrderCommonMsgXml                        -- 消息相关表
-- 136. PBCache
-- 137. PendingCardId
-- 138. PieceMusicInfo
-- 139. PocketMoneyMsgRecord                     -- 消息相关表
-- 140. ProfileInfo
-- 141. RecordCDNInfo
-- 142. RecordMessageInfo                        -- 消息相关表
-- 143. RemittanceRecord
-- 144. RoomVerifyApplicationStg
-- 145. RtosQuickReplyInfo
-- 146. SafeDeviceInfo
-- 147. ScanHistoryItem
-- 148. ScanTranslationResult
-- 149. SelectRecord
-- 150. ShakeNewYearFriendInfo
-- 151. ShareCardInfo
-- 152. ShareCardSyncItemInfo
-- 153. SightDraftInfo
-- 154. SignedAgreementInfo
-- 155. SmileyInfo
-- 156. SmileyPanelConfigInfo
-- 157. Stranger
-- 158. TablesVersion                            -- AB测试相关表
-- 159. TaskBarInfo
-- 160. TopMsgInfoRecord                         -- 消息相关表
-- 161. UDRResource
-- 162. UserCardInfo
-- 163. UserOpenIdInApp
-- 164. VideoEditInfo                            -- 视频相关表
-- 165. VideoHash                                -- 视频相关表
-- 166. VideoPlayHistory                         -- 视频相关表
-- 167. VoiceTransText                           -- 语音转文字表
-- 168. WalletBankcard                           -- 钱包银行卡表
-- 169. WalletBankcardScene                      -- 支付/钱包相关表
-- 170. WalletBulletin                           -- 支付/钱包相关表
-- 171. WalletFunciontList                       -- 支付/钱包相关表
-- 172. WalletKindInfo                           -- 支付/钱包相关表
-- 173. WalletLuckyMoney                         -- 支付/钱包相关表
-- 174. WalletPrefInfo                           -- 支付/钱包相关表
-- 175. WalletRegionGreyAreaList                 -- 支付/钱包相关表
-- 176. WalletUserInfo                           -- 支付/钱包相关表
-- 177. WePkgDiffPackage
-- 178. WebViewData
-- 179. WebViewHistory
-- 180. WebViewHostsFilter
-- 181. WebviewLocalData
-- 182. WepkgPreloadFiles
-- 183. WepkgVersion
-- 184. WeseeProviderInfo
-- 185. WxaTokenInfo
-- 186. addr_upload2
-- 187. appattach
-- 188. appbrandmessage                          -- 消息相关表
-- 189. appbrandnotifymessage                    -- 消息相关表
-- 190. biz_photo_fans_img_info_table            -- 公众号/企业号相关表
-- 191. bizchatmessage                           -- 消息相关表
-- 192. bizfans_img_info_table                   -- 公众号/企业号相关表
-- 193. bizfansmessage                           -- 消息相关表
-- 194. bizfansvideoinfo                         -- 公众号/企业号相关表
-- 195. bizfansvideoinfoVideoHash                -- 公众号/企业号相关表
-- 196. bizinfo                                  -- 公众号信息表
-- 197. bizphotofansvideoinfo                    -- 公众号/企业号相关表
-- 198. bizphotofansvideoinfoVideoHash           -- 公众号/企业号相关表
-- 199. bottlecontact                            -- 联系人相关表
-- 200. bottleconversation
-- 201. bottleinfo1
-- 202. bottlemessage                            -- 消息相关表
-- 203. chatroom                                 -- 群聊表 - 存储群聊信息
-- 204. chattingbginfo
-- 205. contact                                  -- 联系人相关表
-- 206. contact_ext                              -- 联系人相关表
-- 207. conversation
-- 208. facebookfriend
-- 209. finder_img_info_table                    -- 图片相关表
-- 210. findermessage006                         -- 消息相关表
-- 211. findervideoinfo                          -- 视频相关表
-- 212. findervideoinfoVideoHash                 -- 视频相关表
-- 213. fmessage_conversation                    -- 消息相关表
-- 214. fmessage_msginfo                         -- 消息相关表
-- 215. friend_ext
-- 216. gamelife_img_info_table                  -- 图片相关表
-- 217. gamelifemessage                          -- 消息相关表
-- 218. gamelifevideoinfo                        -- 视频相关表
-- 219. gamelifevideoinfoVideoHash               -- 视频相关表
-- 220. getcontactinfov2                         -- 联系人相关表
-- 221. hdheadimginfo                            -- 图片相关表
-- 222. img_flag                                 -- 图片标记表
-- 223. invitefriendopen
-- 224. massendinfo
-- 225. message                                  -- 聊天消息表 - 存储所有聊天消息
-- 226. netstat
-- 227. oplog2
-- 228. packageinfo
-- 229. packageinfo2
-- 230. picfansmsg                               -- 消息相关表
-- 231. qmessage                                 -- 消息相关表
-- 232. qqgroup
-- 233. qqlist
-- 234. rbottleconversation
-- 235. rcontact                                 -- 联系人表 - 存储所有联系人信息
-- 236. rconversation
-- 237. readerappnews1
-- 238. readerappweibo
-- 239. role_info
-- 240. shakeitem1
-- 241. shakemessage                             -- 消息相关表
-- 242. shaketvhistory
-- 243. shakeverifymessage                       -- 消息相关表
-- 244. textstatusmessage                        -- 消息相关表
-- 245. textstatusvideoinfo                      -- 视频相关表
-- 246. textstatusvideoinfoVideoHash             -- 视频相关表
-- 247. tmessage                                 -- 消息相关表
-- 248. userinfo                                 -- 用户信息表 - 存储当前用户信息
-- 249. userinfo2
-- 250. verifycontact                            -- 联系人相关表
-- 251. videoinfo                                -- 视频相关表
-- 252. videoinfo2                               -- 视频信息表 - 存储视频消息详情
-- 253. voiceinfo                                -- 语音信息表 - 存储语音消息详情
-- 254. w1w_img_info_table                       -- 图片相关表
-- 255. w1wmessage                               -- 消息相关表
-- 256. walletcache                              -- 支付/钱包相关表
-- 257. zhugemsgvideoinfo                        -- 消息相关表
-- 258. zhugemsgvideoinfoVideoHash               -- 消息相关表


-- ========================================================
-- 表名: AAPayRecord
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 2

CREATE TABLE AAPayRecord (  payMsgId TEXT PRIMARY KEY ,  insertmsg INTEGER,  chatroom TEXT,  msgId LONG);

-- 字段说明:
--   payMsgId                       TEXT            -- 消息ID (本地) (主键)
--   insertmsg                      INTEGER        
--   chatroom                       TEXT            -- 群聊标志
--   msgId                          LONG            -- 消息ID (本地)


-- ========================================================
-- 表名: AARecord
-- ========================================================
-- 记录数: 5

CREATE TABLE AARecord (  billNo TEXT PRIMARY KEY ,  insertmsg INTEGER,  localMsgId LONG,  status INTEGER default '-1' );

-- 字段说明:
--   billNo                         TEXT            (主键)
--   insertmsg                      INTEGER        
--   localMsgId                     LONG            -- 消息ID (本地)
--   status                         INTEGER         -- 消息状态


-- ========================================================
-- 表名: ABTestInfo
-- 说明: AB测试相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE ABTestInfo (  abtestkey TEXT PRIMARY KEY ,  value TEXT,  expId TEXT,  sequence LONG,  prioritylevel INTEGER,  startTime LONG,  endTime LONG,  noReport INTEGER);

-- 字段说明:
--   abtestkey                      TEXT            (主键)
--   value                          TEXT           
--   expId                          TEXT            -- 自增ID
--   sequence                       LONG           
--   prioritylevel                  INTEGER        
--   startTime                      LONG            -- 开始时间
--   endTime                        LONG            -- 结束时间
--   noReport                       INTEGER        


-- ========================================================
-- 表名: ABTestItem
-- 说明: AB测试相关表
-- ========================================================
-- 记录数: 78

CREATE TABLE ABTestItem (  layerId TEXT PRIMARY KEY ,  business TEXT,  expId TEXT,  sequence LONG,  prioritylevel INTEGER default '0' ,  startTime LONG,  endTime LONG,  needReport INTEGER,  rawXML TEXT default '' );

-- 字段说明:
--   layerId                        TEXT            -- 自增ID (主键)
--   business                       TEXT           
--   expId                          TEXT            -- 自增ID
--   sequence                       LONG           
--   prioritylevel                  INTEGER        
--   startTime                      LONG            -- 开始时间
--   endTime                        LONG            -- 结束时间
--   needReport                     INTEGER        
--   rawXML                         TEXT            -- XML数据


-- ========================================================
-- 表名: ActiveInfo
-- ========================================================
-- 记录数: 20

CREATE TABLE ActiveInfo (  key INTEGER PRIMARY KEY  COLLATE NOCASE ,  mau INTEGER,  dau INTEGER,  useTime LONG);

-- 字段说明:
--   key                            INTEGER         -- AES密钥 (主键)
--   mau                            INTEGER        
--   dau                            INTEGER        
--   useTime                        LONG           


-- ========================================================
-- 表名: AddContactAntispamTicket
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 276

CREATE TABLE AddContactAntispamTicket (  userName TEXT,  scene INTEGER,  ticket TEXT);

-- 字段说明:
--   userName                       TEXT            -- 用户名
--   scene                          INTEGER        
--   ticket                         TEXT            -- 票据


-- ========================================================
-- 表名: ApkChannelPatchInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ApkChannelPatchInfo (  pkgName TEXT PRIMARY KEY ,  isServerPatch INTEGER default 'false' ,  patchPath TEXT,  newChannelApkPath TEXT,  taskStatus INTEGER,  appId TEXT,  scene INTEGER,  ssid INTEGER,  uiarea INTEGER,  noticeId INTEGER,  extInfo TEXT,  userSessionId TEXT,  startTime LONG);

-- 字段说明:
--   pkgName                        TEXT            (主键)
--   isServerPatch                  INTEGER        
--   patchPath                      TEXT           
--   newChannelApkPath              TEXT           
--   taskStatus                     INTEGER         -- 消息状态
--   appId                          TEXT            -- 开放IM应用ID
--   scene                          INTEGER        
--   ssid                           INTEGER         -- 自增ID
--   uiarea                         INTEGER        
--   noticeId                       INTEGER         -- 自增ID
--   extInfo                        TEXT            -- 来源扩展信息
--   userSessionId                  TEXT            -- 自增ID
--   startTime                      LONG            -- 开始时间


-- ========================================================
-- 表名: AppInfo
-- ========================================================
-- 记录数: 823

CREATE TABLE AppInfo (  appId TEXT default ''  PRIMARY KEY ,  appName TEXT,  appDiscription TEXT,  appIconUrl TEXT,  appStoreUrl TEXT,  appVersion INTEGER,  appWatermarkUrl TEXT,  packageName TEXT,  status INTEGER,  signature TEXT,  modifyTime LONG,  appName_en TEXT,  appName_tw TEXT,  appName_hk TEXT,  appDiscription_en TEXT,  appDiscription_tw TEXT,  appType TEXT,  openId TEXT,  authFlag INTEGER,  appInfoFlag INTEGER default '-1' ,  lvbuff BLOB,  serviceAppType INTEGER default '0' ,  serviceAppInfoFlag INTEGER default '0' ,  serviceShowFlag INTEGER default '0' ,  appSupportContentType LONG default '0' ,  svrAppSupportContentType LONG default '0' , packageInfos TEXT);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   appName                        TEXT           
--   appDiscription                 TEXT           
--   appIconUrl                     TEXT           
--   appStoreUrl                    TEXT           
--   appVersion                     INTEGER        
--   appWatermarkUrl                TEXT           
--   packageName                    TEXT           
--   status                         INTEGER         -- 消息状态
--   signature                      TEXT            -- 个性签名
--   modifyTime                     LONG            -- 修改时间
--   appName_en                     TEXT           
--   appName_tw                     TEXT           
--   appName_hk                     TEXT           
--   appDiscription_en              TEXT           
--   appDiscription_tw              TEXT           
--   appType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   openId                         TEXT            -- 自增ID
--   authFlag                       INTEGER         -- 标记
--   appInfoFlag                    INTEGER         -- 标记
--   lvbuff                         BLOB            -- 二进制数据
--   serviceAppType                 INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   serviceAppInfoFlag             INTEGER         -- 标记
--   serviceShowFlag                INTEGER         -- 标记
--   appSupportContentType          LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   svrAppSupportContentType       LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   packageInfos                   TEXT           


-- ========================================================
-- 表名: AppMessage
-- 说明: 应用消息表 - 存储小程序/链接等消息
-- ========================================================
-- 记录数: 310,911

CREATE TABLE AppMessage (  msgId LONG default '0'  PRIMARY KEY ,  xml TEXT,  appId TEXT,  title TEXT,  description TEXT,  source TEXT,  type INTEGER, msgSvrId LONG, msgTalker TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   xml                            TEXT            -- XML数据
--   appId                          TEXT            -- 开放IM应用ID
--   title                          TEXT           
--   description                    TEXT           
--   source                         TEXT            -- 来源扩展信息
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   msgSvrId                       LONG            -- 消息服务器ID
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: AppSort
-- ========================================================
-- 记录数: 0

CREATE TABLE AppSort (  flag LONG default '0' ,  appId TEXT default '' ,  sortId INTEGER default '0' );

-- 字段说明:
--   flag                           LONG            -- 标记
--   appId                          TEXT            -- 开放IM应用ID
--   sortId                         INTEGER         -- 自增ID


-- ========================================================
-- 表名: BackupMoveTime
-- 说明: 备份相关表
-- ========================================================
-- 记录数: 694

CREATE TABLE BackupMoveTime (  deviceId TEXT default '' ,  sessionName TEXT default '' ,  moveTime BLOB default '' );

-- 字段说明:
--   deviceId                       TEXT            -- 自增ID
--   sessionName                    TEXT           
--   moveTime                       BLOB           


-- ========================================================
-- 表名: BackupRecoverMsgListDataId
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE BackupRecoverMsgListDataId (  msgListDataId TEXT PRIMARY KEY ,  sessionName TEXT default '' );

-- 字段说明:
--   msgListDataId                  TEXT            -- 自增ID (主键)
--   sessionName                    TEXT           


-- ========================================================
-- 表名: BackupTempMoveTime
-- 说明: 备份相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE BackupTempMoveTime (  sessionName TEXT default '' ,  startTime LONG default '0' ,  endTime LONG default '0' );

-- 字段说明:
--   sessionName                    TEXT           
--   startTime                      LONG            -- 开始时间
--   endTime                        LONG            -- 结束时间


-- ========================================================
-- 表名: BizAdInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 100

CREATE TABLE BizAdInfo (  aId TEXT PRIMARY KEY ,  msgId LONG,  exposeTime LONG);

-- 字段说明:
--   aId                            TEXT            -- 自增ID (主键)
--   msgId                          LONG            -- 消息ID (本地)
--   exposeTime                     LONG           


-- ========================================================
-- 表名: BizAppMsgReportContext
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE BizAppMsgReportContext (  appMsgReportContextId LONG PRIMARY KEY ,  url TEXT,  reportTime LONG,  aScene INTEGER);

-- 字段说明:
--   appMsgReportContextId          LONG            -- 自增ID (主键)
--   url                            TEXT            -- CDN大图URL
--   reportTime                     LONG           
--   aScene                         INTEGER        


-- ========================================================
-- 表名: BizBlockFinderInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE BizBlockFinderInfo (  bizUsername TEXT PRIMARY KEY ,  finderUsername TEXT);

-- 字段说明:
--   bizUsername                    TEXT            -- 用户名 (主键)
--   finderUsername                 TEXT            -- 用户名


-- ========================================================
-- 表名: BizChatConversation
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 7

CREATE TABLE BizChatConversation (  bizChatId LONG PRIMARY KEY ,  brandUserName TEXT,  unReadCount INTEGER,  newUnReadCount INTEGER,  lastMsgID LONG,  lastMsgTime LONG,  content TEXT,  digest TEXT default '' ,  digestUser TEXT default '' ,  atCount INTEGER default '0' ,  editingMsg TEXT,  chatType INTEGER,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  msgType TEXT default '' ,  msgCount INTEGER default '0' ,  flag LONG default '0' ,  atAll INTEGER default '0' );

-- 字段说明:
--   bizChatId                      LONG            -- 业务聊天ID (主键)
--   brandUserName                  TEXT            -- 用户名
--   unReadCount                    INTEGER        
--   newUnReadCount                 INTEGER        
--   lastMsgID                      LONG            -- 消息ID (本地)
--   lastMsgTime                    LONG           
--   content                        TEXT            -- 消息内容
--   digest                         TEXT           
--   digestUser                     TEXT           
--   atCount                        INTEGER        
--   editingMsg                     TEXT           
--   chatType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   msgType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   msgCount                       INTEGER        
--   flag                           LONG            -- 标记
--   atAll                          INTEGER        


-- ========================================================
-- 表名: BizChatInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 7

CREATE TABLE BizChatInfo (  bizChatLocalId LONG PRIMARY KEY ,  bizChatServId TEXT,  brandUserName TEXT default '' ,  chatType INTEGER,  headImageUrl TEXT,  chatName TEXT default '' ,  chatNamePY TEXT default '' ,  chatVersion INTEGER default '-1' ,  needToUpdate INTEGER default 'true' ,  bitFlag INTEGER default '0' ,  maxMemberCnt INTEGER default '0' ,  ownerUserId TEXT,  userList TEXT,  addMemberUrl TEXT,  roomflag INTEGER default '0' );

-- 字段说明:
--   bizChatLocalId                 LONG            -- 自增ID (主键)
--   bizChatServId                  TEXT            -- 自增ID
--   brandUserName                  TEXT            -- 用户名
--   chatType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   headImageUrl                   TEXT           
--   chatName                       TEXT            -- 真实聊天名称
--   chatNamePY                     TEXT           
--   chatVersion                    INTEGER        
--   needToUpdate                   INTEGER        
--   bitFlag                        INTEGER         -- 标记
--   maxMemberCnt                   INTEGER        
--   ownerUserId                    TEXT            -- 自增ID
--   userList                       TEXT            -- 点赞用户列表
--   addMemberUrl                   TEXT           
--   roomflag                       INTEGER         -- 标记


-- ========================================================
-- 表名: BizChatMyUserInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 3

CREATE TABLE BizChatMyUserInfo (  brandUserName TEXT PRIMARY KEY ,  userId TEXT);

-- 字段说明:
--   brandUserName                  TEXT            -- 用户名 (主键)
--   userId                         TEXT            -- 业务聊天用户ID


-- ========================================================
-- 表名: BizChatUserInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 59

CREATE TABLE BizChatUserInfo (  userId TEXT PRIMARY KEY ,  userName TEXT default '' ,  userNamePY TEXT default '' ,  brandUserName TEXT default '' ,  UserVersion INTEGER default '-1' ,  needToUpdate INTEGER default 'true' ,  headImageUrl TEXT,  profileUrl TEXT,  bitFlag INTEGER default '0' ,  addMemberUrl TEXT);

-- 字段说明:
--   userId                         TEXT            -- 业务聊天用户ID (主键)
--   userName                       TEXT            -- 用户名
--   userNamePY                     TEXT            -- 用户名
--   brandUserName                  TEXT            -- 用户名
--   UserVersion                    INTEGER        
--   needToUpdate                   INTEGER        
--   headImageUrl                   TEXT           
--   profileUrl                     TEXT           
--   bitFlag                        INTEGER         -- 标记
--   addMemberUrl                   TEXT           


-- ========================================================
-- 表名: BizContactConversationMassSend
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 4,942

CREATE TABLE BizContactConversationMassSend (  msgId LONG PRIMARY KEY ,  createTime LONG,  massSendType INTEGER default '0' ,  clusterType INTEGER default '0' ,  scene INTEGER default '0' ,  talker TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   createTime                     LONG            -- 创建时间
--   massSendType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   clusterType                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   scene                          INTEGER        
--   talker                         TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: BizEnterprise
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 17

CREATE TABLE BizEnterprise (  userName TEXT PRIMARY KEY ,  qyUin INTEGER,  userUin INTEGER,  userFlag INTEGER,  wwExposeTimes INTEGER,  wwMaxExposeTimes INTEGER,  wwCorpId LONG,  wwUserVid LONG,  userType INTEGER,  chatOpen INTEGER,  wwUnreadCnt INTEGER default '0' ,  show_confirm INTEGER,  use_preset_banner_tips INTEGER,  hide_create_chat INTEGER,  hide_mod_chat_member INTEGER,  hide_colleage_invite INTEGER default 'true' ,  raw_attrs BLOB);

-- 字段说明:
--   userName                       TEXT            -- 用户名 (主键)
--   qyUin                          INTEGER        
--   userUin                        INTEGER        
--   userFlag                       INTEGER         -- 标记
--   wwExposeTimes                  INTEGER        
--   wwMaxExposeTimes               INTEGER        
--   wwCorpId                       LONG            -- 自增ID
--   wwUserVid                      LONG            -- 自增ID
--   userType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   chatOpen                       INTEGER        
--   wwUnreadCnt                    INTEGER        
--   show_confirm                   INTEGER        
--   use_preset_banner_tips         INTEGER        
--   hide_create_chat               INTEGER         -- 自增ID
--   hide_mod_chat_member           INTEGER         -- 自增ID
--   hide_colleage_invite           INTEGER         -- 自增ID
--   raw_attrs                      BLOB           


-- ========================================================
-- 表名: BizFollowedContactDigest
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 139

CREATE TABLE BizFollowedContactDigest (  bizUsername TEXT default ''  PRIMARY KEY ,  updateTime LONG default '0' ,  digest TEXT default '' );

-- 字段说明:
--   bizUsername                    TEXT            -- 用户名 (主键)
--   updateTime                     LONG            -- 更新时间
--   digest                         TEXT           


-- ========================================================
-- 表名: BizKF
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 11

CREATE TABLE BizKF (  openId TEXT PRIMARY KEY ,  brandUsername TEXT default '' ,  headImgUrl TEXT,  nickname TEXT,  kfType INTEGER,  updateTime LONG);

-- 字段说明:
--   openId                         TEXT            -- 自增ID (主键)
--   brandUsername                  TEXT            -- 用户名
--   headImgUrl                     TEXT            -- 头像URL
--   nickname                       TEXT            -- 昵称
--   kfType                         INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: BizPhotoSingleMsgInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE BizPhotoSingleMsgInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER,  resortBuffer TEXT default '' ,  recycleCardType INTEGER default '0' ,  recommendReason TEXT default '' ,  originBitFlag INTEGER default '0' ,  mergeShowTime LONG,  mergeCount INTEGER default '0' ,  notifyMsgId TEXT default '' ,  notifyMsgBlockFlag INTEGER,  silentFoldMsgReadStatus INTEGER,  mpArticleKey TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   isExpand                       INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   orderFlag                      LONG            -- 标记
--   hasShow                        INTEGER        
--   placeTop                       INTEGER        
--   appMsgStatInfoProto            BLOB           
--   isRead                         INTEGER        
--   bitFlag                        INTEGER         -- 标记
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   rankSessionId                  TEXT            -- 自增ID
--   recommendCardId                TEXT            -- 自增ID
--   isValidExposed                 INTEGER         -- 自增ID
--   resortBuffer                   TEXT            -- 二进制Buffer
--   recycleCardType                INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   recommendReason                TEXT           
--   originBitFlag                  INTEGER         -- 标记
--   mergeShowTime                  LONG           
--   mergeCount                     INTEGER        
--   notifyMsgId                    TEXT            -- 消息ID (本地)
--   notifyMsgBlockFlag             INTEGER         -- 标记
--   silentFoldMsgReadStatus        INTEGER         -- 消息状态
--   mpArticleKey                   TEXT           


-- ========================================================
-- 表名: BizRecExposeInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 161

CREATE TABLE BizRecExposeInfo (  exposeId TEXT PRIMARY KEY ,  msgId LONG,  exposeTime LONG,  exposeType INTEGER);

-- 字段说明:
--   exposeId                       TEXT            -- 自增ID (主键)
--   msgId                          LONG            -- 消息ID (本地)
--   exposeTime                     LONG           
--   exposeType                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: BizScreenshotInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 3

CREATE TABLE BizScreenshotInfo (  screenshotMd5 TEXT PRIMARY KEY ,  screenshotPath TEXT,  url TEXT,  screenshotTime LONG,  biz LONG,  mid LONG,  idx LONG,  itemShowType INTEGER);

-- 字段说明:
--   screenshotMd5                  TEXT            -- MD5值 (主键)
--   screenshotPath                 TEXT           
--   url                            TEXT            -- CDN大图URL
--   screenshotTime                 LONG           
--   biz                            LONG            -- 业务客户端消息ID
--   mid                            LONG            -- 中图路径
--   idx                            LONG            -- 自增ID
--   itemShowType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: BizTimeLineInfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 1,042

CREATE TABLE BizTimeLineInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER, resortBuffer TEXT default '');

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   isExpand                       INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   orderFlag                      LONG            -- 标记
--   hasShow                        INTEGER        
--   placeTop                       INTEGER        
--   appMsgStatInfoProto            BLOB           
--   isRead                         INTEGER        
--   bitFlag                        INTEGER         -- 标记
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   rankSessionId                  TEXT            -- 自增ID
--   recommendCardId                TEXT            -- 自增ID
--   isValidExposed                 INTEGER         -- 自增ID
--   resortBuffer                   TEXT            -- 二进制Buffer


-- ========================================================
-- 表名: BizTimeLineSingleMsgInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 102

CREATE TABLE BizTimeLineSingleMsgInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER, resortBuffer TEXT default '', recycleCardType INTEGER default '0', recommendReason TEXT default '', originBitFlag INTEGER default '0', notifyMsgId TEXT default '', mergeCount INTEGER default '0', mergeShowTime LONG, mpArticleKey TEXT, notifyMsgBlockFlag INTEGER, silentFoldMsgReadStatus INTEGER);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   isExpand                       INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   orderFlag                      LONG            -- 标记
--   hasShow                        INTEGER        
--   placeTop                       INTEGER        
--   appMsgStatInfoProto            BLOB           
--   isRead                         INTEGER        
--   bitFlag                        INTEGER         -- 标记
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   rankSessionId                  TEXT            -- 自增ID
--   recommendCardId                TEXT            -- 自增ID
--   isValidExposed                 INTEGER         -- 自增ID
--   resortBuffer                   TEXT            -- 二进制Buffer
--   recycleCardType                INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   recommendReason                TEXT           
--   originBitFlag                  INTEGER         -- 标记
--   notifyMsgId                    TEXT            -- 消息ID (本地)
--   mergeCount                     INTEGER        
--   mergeShowTime                  LONG           
--   mpArticleKey                   TEXT           
--   notifyMsgBlockFlag             INTEGER         -- 标记
--   silentFoldMsgReadStatus        INTEGER         -- 消息状态


-- ========================================================
-- 表名: CardMsgInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 7

CREATE TABLE CardMsgInfo (  card_type INTEGER,  title TEXT,  description TEXT,  logo_url TEXT,  time INTEGER,  card_id TEXT,  card_tp_id TEXT,  msg_id TEXT PRIMARY KEY ,  msg_type INTEGER,  jump_type INTEGER,  url TEXT,  buttonData BLOB,  operData BLOB,  report_scene INTEGER,  read_state INTEGER default '0' ,  accept_buttons TEXT,  consumed_box_id TEXT,  jump_buttons TEXT,  logo_color TEXT,  unavailable_qr_code_list TEXT,  all_unavailable INTEGER default 'false' ,  need_pull_card_entrance INTEGER default 'false' );

-- 字段说明:
--   card_type                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   title                          TEXT           
--   description                    TEXT           
--   logo_url                       TEXT           
--   time                           INTEGER         -- 是否显示时间
--   card_id                        TEXT            -- 自增ID
--   card_tp_id                     TEXT            -- 自增ID
--   msg_id                         TEXT            -- 自增ID (主键)
--   msg_type                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   jump_type                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   url                            TEXT            -- CDN大图URL
--   buttonData                     BLOB            -- 数据
--   operData                       BLOB            -- 数据
--   report_scene                   INTEGER        
--   read_state                     INTEGER        
--   accept_buttons                 TEXT           
--   consumed_box_id                TEXT            -- 自增ID
--   jump_buttons                   TEXT           
--   logo_color                     TEXT           
--   unavailable_qr_code_list       TEXT           
--   all_unavailable                INTEGER        
--   need_pull_card_entrance        INTEGER        


-- ========================================================
-- 表名: CardQrCodeConfi
-- ========================================================
-- 记录数: 0

CREATE TABLE CardQrCodeConfi (  card_id TEXT PRIMARY KEY ,  lower_bound INTEGER,  need_insert_show_timestamp INTEGER default 'false' ,  show_timestamp_encrypt_key TEXT,  expire_time_interval INTEGER,  show_expire_interval INTEGER,  fetch_time LONG);

-- 字段说明:
--   card_id                        TEXT            -- 自增ID (主键)
--   lower_bound                    INTEGER        
--   need_insert_show_timestamp     INTEGER        
--   show_timestamp_encrypt_key     TEXT           
--   expire_time_interval           INTEGER        
--   show_expire_interval           INTEGER        
--   fetch_time                     LONG           


-- ========================================================
-- 表名: CardQrCodeDataInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE CardQrCodeDataInfo (  code_id TEXT,  card_id TEXT,  code TEXT,  status INTEGER);

-- 字段说明:
--   code_id                        TEXT            -- 自增ID
--   card_id                        TEXT            -- 自增ID
--   code                           TEXT           
--   status                         INTEGER         -- 消息状态


-- ========================================================
-- 表名: CdnDownloadInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE CdnDownloadInfo (  mediaId TEXT,  downloadUrlHashCode INTEGER PRIMARY KEY ,  downloadUrl TEXT,  httpsUrl TEXT,  filePath TEXT,  verifyHeaders TEXT,  game_package_download INTEGER,  allowMobileNetDownload INTEGER,  wifiAutoDownload INTEGER);

-- 字段说明:
--   mediaId                        TEXT            -- 自增ID
--   downloadUrlHashCode            INTEGER         (主键)
--   downloadUrl                    TEXT           
--   httpsUrl                       TEXT           
--   filePath                       TEXT           
--   verifyHeaders                  TEXT           
--   game_package_download          INTEGER        
--   allowMobileNetDownload         INTEGER        
--   wifiAutoDownload               INTEGER        


-- ========================================================
-- 表名: ChatBotConfig
-- ========================================================
-- 记录数: 0

CREATE TABLE ChatBotConfig (  userName TEXT PRIMARY KEY ,  menu TEXT,  profileInfoDetail TEXT,  serviceAgreement TEXT,  toolbarFlag LONG,  InteractiveMode INTEGER, openIMDescId TEXT, openIMCustomInfo TEXT, openIMId TEXT);

-- 字段说明:
--   userName                       TEXT            -- 用户名 (主键)
--   menu                           TEXT           
--   profileInfoDetail              TEXT           
--   serviceAgreement               TEXT           
--   toolbarFlag                    LONG            -- 标记
--   InteractiveMode                INTEGER        
--   openIMDescId                   TEXT            -- 自增ID
--   openIMCustomInfo               TEXT           
--   openIMId                       TEXT            -- 自增ID


-- ========================================================
-- 表名: ChatroomMsgSeq
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE ChatroomMsgSeq (  username TEXT default ''  PRIMARY KEY ,  lastPushSeq LONG,  lastLocalSeq LONG,  lastPushCreateTime LONG,  lastLocalCreateTime LONG,  seqBlockInfo BLOB);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   lastPushSeq                    LONG           
--   lastLocalSeq                   LONG           
--   lastPushCreateTime             LONG            -- 创建时间
--   lastLocalCreateTime            LONG            -- 创建时间
--   seqBlockInfo                   BLOB           


-- ========================================================
-- 表名: ChatroomNoticeAttachIndex
-- 说明: 群聊相关表
-- ========================================================
-- 记录数: 270

CREATE TABLE ChatroomNoticeAttachIndex (  msgId LONG,  dataId TEXT,  dataPath TEXT,  thumbPath TEXT,  size LONG);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地)
--   dataId                         TEXT            -- 自增ID
--   dataPath                       TEXT            -- 数据
--   thumbPath                      TEXT            -- 缩略图路径
--   size                           LONG           


-- ========================================================
-- 表名: CleanDeleteItem
-- ========================================================
-- 记录数: 100,000

CREATE TABLE CleanDeleteItem (  createTime LONG default '0' ,  modifyTime LONG default '0' ,  deleteTime LONG default '0' ,  id TEXT default '' ,  saveTime LONG default '0' ,  size LONG default '0' ,  flags LONG default '0' );

-- 字段说明:
--   createTime                     LONG            -- 创建时间
--   modifyTime                     LONG            -- 修改时间
--   deleteTime                     LONG           
--   id                             TEXT            -- 自增ID
--   saveTime                       LONG           
--   size                           LONG           
--   flags                          LONG            -- 标记


-- ========================================================
-- 表名: ContactCmdBuf
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 436

CREATE TABLE ContactCmdBuf (  username TEXT default ''  PRIMARY KEY ,  cmdbuf BLOB default '' , fieldUpdateCtrlInfoList BLOB);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   cmdbuf                         BLOB            -- 二进制Buffer
--   fieldUpdateCtrlInfoList        BLOB           


-- ========================================================
-- 表名: ContactLabel
-- 说明: 联系人标签表
-- ========================================================
-- 记录数: 8

CREATE TABLE ContactLabel (  labelID INTEGER PRIMARY KEY ,  labelName TEXT,  labelPYFull TEXT,  labelPYShort TEXT,  createTime LONG,  isTemporary INTEGER, lastUseTime LONG);

-- 字段说明:
--   labelID                        INTEGER         -- 联系人标签ID (主键)
--   labelName                      TEXT           
--   labelPYFull                    TEXT           
--   labelPYShort                   TEXT           
--   createTime                     LONG            -- 创建时间
--   isTemporary                    INTEGER        
--   lastUseTime                    LONG           


-- ========================================================
-- 表名: ContactLabelCache
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE ContactLabelCache (  labelId TEXT,  contactName TEXT);

-- 字段说明:
--   labelId                        TEXT            -- 联系人标签ID
--   contactName                    TEXT           


-- ========================================================
-- 表名: DelayTransferRecord
-- ========================================================
-- 记录数: 0

CREATE TABLE DelayTransferRecord (  msgId LONG PRIMARY KEY ,  transferId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   transferId                     TEXT            -- 转账ID


-- ========================================================
-- 表名: DeletedConversationInfo
-- ========================================================
-- 记录数: 745

CREATE TABLE DeletedConversationInfo ( userName TEXT  PRIMARY KEY , lastSeq LONG  , reserved1 INT  , reserved2 LONG  , reserved3 TEXT  );

-- 字段说明:
--   userName                       TEXT            -- 用户名 (主键)
--   lastSeq                        LONG           
--   reserved1                      INT             -- 保留字段1
--   reserved2                      LONG            -- 保留字段2
--   reserved3                      TEXT            -- 保留字段3


-- ========================================================
-- 表名: DownloadTaskItem
-- ========================================================
-- 记录数: 0

CREATE TABLE DownloadTaskItem (  appId TEXT PRIMARY KEY ,  status INTEGER,  modifyTime LONG);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   status                         INTEGER         -- 消息状态
--   modifyTime                     LONG            -- 修改时间


-- ========================================================
-- 表名: EmojiDesignerProduct
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 343

CREATE TABLE EmojiDesignerProduct (  designerUin INTEGER,  productId TEXT,  syncTime INTEGER);

-- 字段说明:
--   designerUin                    INTEGER        
--   productId                      TEXT            -- 自增ID
--   syncTime                       INTEGER        


-- ========================================================
-- 表名: EmojiGroupInfo
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 9

CREATE TABLE EmojiGroupInfo (  productID TEXT PRIMARY KEY  COLLATE NOCASE ,  packIconUrl TEXT,  packGrayIconUrl TEXT,  packCoverUrl TEXT,  packName TEXT,  packDesc TEXT,  packAuthInfo TEXT,  packPrice TEXT,  packType INTEGER,  packFlag INTEGER,  packExpire LONG,  packTimeStamp LONG,  packCopyright TEXT,  type INTEGER,  status INTEGER,  sort INTEGER default '1' ,  lastUseTime LONG,  packStatus INTEGER default '0' ,  flag INTEGER default '0' ,  recommand INTEGER default '0' ,  sync INTEGER default '0' ,  idx INTEGER default '0' ,  BigIconUrl TEXT,  MutiLanName TEXT,  recommandType INTEGER default '-1' ,  lang TEXT,  recommandWord TEXT,  buttonType INTEGER,  count INTEGER, ipKey TEXT);

-- 字段说明:
--   productID                      TEXT            -- 自增ID (主键)
--   packIconUrl                    TEXT           
--   packGrayIconUrl                TEXT           
--   packCoverUrl                   TEXT           
--   packName                       TEXT           
--   packDesc                       TEXT           
--   packAuthInfo                   TEXT           
--   packPrice                      TEXT           
--   packType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   packFlag                       INTEGER         -- 标记
--   packExpire                     LONG           
--   packTimeStamp                  LONG           
--   packCopyright                  TEXT           
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   sort                           INTEGER        
--   lastUseTime                    LONG           
--   packStatus                     INTEGER         -- 消息状态
--   flag                           INTEGER         -- 标记
--   recommand                      INTEGER        
--   sync                           INTEGER        
--   idx                            INTEGER         -- 自增ID
--   BigIconUrl                     TEXT           
--   MutiLanName                    TEXT           
--   recommandType                  INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   lang                           TEXT           
--   recommandWord                  TEXT           
--   buttonType                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   count                          INTEGER         -- 成员数量
--   ipKey                          TEXT           


-- ========================================================
-- 表名: EmojiIPSetInfo
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE EmojiIPSetInfo (  key TEXT PRIMARY KEY ,  title TEXT,  desc TEXT,  iconUrl TEXT,  panelUrl TEXT);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   title                          TEXT           
--   desc                           TEXT            -- 描述文字ID
--   iconUrl                        TEXT           
--   panelUrl                       TEXT           


-- ========================================================
-- 表名: EmojiInfo
-- 说明: 表情信息表
-- ========================================================
-- 记录数: 8,270

CREATE TABLE EmojiInfo (  md5 TEXT PRIMARY KEY  COLLATE NOCASE ,  svrid TEXT,  catalog INTEGER,  type INTEGER,  size INTEGER,  start INTEGER,  state INTEGER,  name TEXT,  content TEXT,  reserved1 TEXT,  reserved2 TEXT,  reserved3 INTEGER,  reserved4 INTEGER,  app_id TEXT,  groupId TEXT default '' ,  lastUseTime LONG,  framesInfo TEXT default '' ,  idx INTEGER default '0' ,  temp INTEGER default '0' ,  source INTEGER default '0' ,  needupload INTEGER default '0' ,  designerID TEXT,  thumbUrl TEXT,  cdnUrl TEXT,  encrypturl TEXT,  aeskey TEXT,  width INTEGER default '0' ,  height INTEGER default '0' ,  externUrl TEXT,  externMd5 TEXT,  activityid TEXT,  tpurl TEXT,  tpauthkey TEXT,  wxamMd5 TEXT,  attachedText TEXT,  captureStatus INTEGER default '0' ,  attachedEmojiMD5 BLOB default '' ,  imitateMd5 TEXT,  captureUploadErrCode INTEGER default '0' ,  captureUploadCounter INTEGER default '0' ,  captureEnterTime LONG,  lensId TEXT,  attachTextColor TEXT,  captureScene INTEGER,  attr TEXT,  linkId TEXT,  meanings TEXT, custom_meaning TEXT, emojiFlag LONG default '0', isOcrProcessed INTEGER default '0', storeUnique INTEGER default '0');

-- 字段说明:
--   md5                            TEXT            -- MD5值 (主键)
--   svrid                          TEXT            -- 消息服务器ID
--   catalog                        INTEGER        
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   size                           INTEGER        
--   start                          INTEGER         -- 开始时间
--   state                          INTEGER        
--   name                           TEXT            -- 用户名
--   content                        TEXT            -- 消息内容
--   reserved1                      TEXT            -- 保留字段1
--   reserved2                      TEXT            -- 保留字段2
--   reserved3                      INTEGER         -- 保留字段3
--   reserved4                      INTEGER         -- 保留字段4
--   app_id                         TEXT            -- 自增ID
--   groupId                        TEXT            -- 自增ID
--   lastUseTime                    LONG           
--   framesInfo                     TEXT           
--   idx                            INTEGER         -- 自增ID
--   temp                           INTEGER        
--   source                         INTEGER         -- 来源扩展信息
--   needupload                     INTEGER        
--   designerID                     TEXT            -- 自增ID
--   thumbUrl                       TEXT            -- CDN缩略图URL
--   cdnUrl                         TEXT           
--   encrypturl                     TEXT           
--   aeskey                         TEXT            -- AES密钥
--   width                          INTEGER         -- CDN缩略图宽度
--   height                         INTEGER         -- CDN缩略图高度
--   externUrl                      TEXT            -- 扩展
--   externMd5                      TEXT            -- MD5值
--   activityid                     TEXT            -- 自增ID
--   tpurl                          TEXT           
--   tpauthkey                      TEXT           
--   wxamMd5                        TEXT            -- MD5值
--   attachedText                   TEXT            -- 扩展
--   captureStatus                  INTEGER         -- 消息状态
--   attachedEmojiMD5               BLOB            -- MD5值
--   imitateMd5                     TEXT            -- MD5值
--   captureUploadErrCode           INTEGER        
--   captureUploadCounter           INTEGER        
--   captureEnterTime               LONG           
--   lensId                         TEXT            -- 自增ID
--   attachTextColor                TEXT            -- 扩展
--   captureScene                   INTEGER        
--   attr                           TEXT            -- 属性Buffer (protobuf)
--   linkId                         TEXT            -- 自增ID
--   meanings                       TEXT           
--   custom_meaning                 TEXT           
--   emojiFlag                      LONG            -- 标记
--   isOcrProcessed                 INTEGER        
--   storeUnique                    INTEGER        


-- ========================================================
-- 表名: EmojiInfoDesc
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 9,394

CREATE TABLE EmojiInfoDesc (  md5_lang TEXT PRIMARY KEY  COLLATE NOCASE ,  md5 TEXT COLLATE NOCASE ,  lang TEXT COLLATE NOCASE ,  desc TEXT,  groupId TEXT default '' ,  click_flag INTEGER,  download_flag INTEGER);

-- 字段说明:
--   md5_lang                       TEXT            -- MD5值 (主键)
--   md5                            TEXT            -- MD5值
--   lang                           TEXT           
--   desc                           TEXT            -- 描述文字ID
--   groupId                        TEXT            -- 自增ID
--   click_flag                     INTEGER         -- 标记
--   download_flag                  INTEGER         -- 标记


-- ========================================================
-- 表名: EmojiSuggestCacheInfo
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 100

CREATE TABLE EmojiSuggestCacheInfo (  desc TEXT PRIMARY KEY ,  updateTime INTEGER,  content BLOB);

-- 字段说明:
--   desc                           TEXT            -- 描述文字ID (主键)
--   updateTime                     INTEGER         -- 更新时间
--   content                        BLOB            -- 消息内容


-- ========================================================
-- 表名: EmojiSuggestDescInfo
-- 说明: 表情相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE EmojiSuggestDescInfo (  groupID TEXT,  desc TEXT);

-- 字段说明:
--   groupID                        TEXT            -- 自增ID
--   desc                           TEXT            -- 描述文字ID


-- ========================================================
-- 表名: EmotionDesignerInfo
-- ========================================================
-- 记录数: 1

CREATE TABLE EmotionDesignerInfo (  designerIDAndType TEXT PRIMARY KEY ,  content BLOB default '' );

-- 字段说明:
--   designerIDAndType              TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息) (主键)
--   content                        BLOB            -- 消息内容


-- ========================================================
-- 表名: EmotionDetailInfo
-- ========================================================
-- 记录数: 30

CREATE TABLE EmotionDetailInfo (  productID TEXT PRIMARY KEY ,  content BLOB default '' ,  lan TEXT default '' );

-- 字段说明:
--   productID                      TEXT            -- 自增ID (主键)
--   content                        BLOB            -- 消息内容
--   lan                            TEXT           


-- ========================================================
-- 表名: EmotionRewardInfo
-- ========================================================
-- 记录数: 1

CREATE TABLE EmotionRewardInfo (  productID TEXT PRIMARY KEY ,  content BLOB default '' );

-- 字段说明:
--   productID                      TEXT            -- 自增ID (主键)
--   content                        BLOB            -- 消息内容


-- ========================================================
-- 表名: EmotionRewardTipInfo
-- ========================================================
-- 记录数: 29

CREATE TABLE EmotionRewardTipInfo (  prodcutID TEXT PRIMARY KEY ,  totalCount INTEGER,  continuCount INTEGER,  flag INTEGER,  modifyTime LONG,  showTipsTime LONG,  setFlagTime LONG);

-- 字段说明:
--   prodcutID                      TEXT            -- 自增ID (主键)
--   totalCount                     INTEGER        
--   continuCount                   INTEGER        
--   flag                           INTEGER         -- 标记
--   modifyTime                     LONG            -- 修改时间
--   showTipsTime                   LONG           
--   setFlagTime                    LONG            -- 标记


-- ========================================================
-- 表名: FavOffline
-- 说明: 收藏相关表
-- ========================================================
-- 记录数: 1

CREATE TABLE FavOffline (  url TEXT,  size LONG,  path TEXT,  imgDirPath TEXT,  imgPaths TEXT,  favTime LONG,  updateTime LONG,  status INTEGER,  failNum INTEGER,  isReport INTEGER);

-- 字段说明:
--   url                            TEXT            -- CDN大图URL
--   size                           LONG           
--   path                           TEXT            -- 图片路径
--   imgDirPath                     TEXT           
--   imgPaths                       TEXT            -- 图片路径
--   favTime                        LONG           
--   updateTime                     LONG            -- 更新时间
--   status                         INTEGER         -- 消息状态
--   failNum                        INTEGER        
--   isReport                       INTEGER        


-- ========================================================
-- 表名: FileDownloadInfo
-- ========================================================
-- 记录数: 28

CREATE TABLE FileDownloadInfo (  downloadId LONG default '-1'  PRIMARY KEY ,  downloadUrl TEXT default '' ,  secondaryUrl TEXT default '' ,  fileSize LONG default '0' ,  fileName TEXT default '' ,  filePath TEXT default '' ,  fileType INTEGER default '0' ,  status INTEGER default '0' ,  md5 TEXT default '' ,  autoInstall INTEGER default 'false' ,  showNotification INTEGER default 'false' ,  sysDownloadId LONG default '-1' ,  downloaderType INTEGER default '0' ,  appId TEXT default '' ,  downloadUrlHashCode INTEGER default '0' ,  packageName TEXT default '' ,  downloadedSize LONG default '0' ,  totalSize LONG default '0' ,  autoDownload INTEGER default 'false' ,  channelId TEXT default '' ,  scene INTEGER default '0' ,  errCode INTEGER default '0' ,  startTime LONG default '0' ,  startSize LONG default '0' ,  startState INTEGER default '0' ,  fromWeApp INTEGER default 'false' ,  downloadInWifi INTEGER default 'false' ,  extInfo TEXT default '' ,  finishTime LONG default '0' ,  isSecondDownload INTEGER default 'false' ,  fromDownloadApp INTEGER default 'false' ,  updateTime LONG default '0' ,  reserveInWifi INTEGER default 'false' ,  ssid INTEGER default '0' ,  uiarea INTEGER default '0' ,  noticeId INTEGER default '0' ,  downloadType INTEGER default '0' ,  startScene INTEGER default '0' ,  sectionMd5Byte BLOB,  rawAppId TEXT default '' ,  notificationTitle TEXT default '' , userSessionId TEXT default '', enableBrotli INTEGER default 'false');

-- 字段说明:
--   downloadId                     LONG            -- 自增ID (主键)
--   downloadUrl                    TEXT           
--   secondaryUrl                   TEXT           
--   fileSize                       LONG           
--   fileName                       TEXT           
--   filePath                       TEXT           
--   fileType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   md5                            TEXT            -- MD5值
--   autoInstall                    INTEGER        
--   showNotification               INTEGER        
--   sysDownloadId                  LONG            -- 自增ID
--   downloaderType                 INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   appId                          TEXT            -- 开放IM应用ID
--   downloadUrlHashCode            INTEGER        
--   packageName                    TEXT           
--   downloadedSize                 LONG           
--   totalSize                      LONG           
--   autoDownload                   INTEGER        
--   channelId                      TEXT            -- 自增ID
--   scene                          INTEGER        
--   errCode                        INTEGER        
--   startTime                      LONG            -- 开始时间
--   startSize                      LONG           
--   startState                     INTEGER        
--   fromWeApp                      INTEGER        
--   downloadInWifi                 INTEGER        
--   extInfo                        TEXT            -- 来源扩展信息
--   finishTime                     LONG           
--   isSecondDownload               INTEGER        
--   fromDownloadApp                INTEGER        
--   updateTime                     LONG            -- 更新时间
--   reserveInWifi                  INTEGER        
--   ssid                           INTEGER         -- 自增ID
--   uiarea                         INTEGER        
--   noticeId                       INTEGER         -- 自增ID
--   downloadType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   startScene                     INTEGER        
--   sectionMd5Byte                 BLOB            -- MD5值
--   rawAppId                       TEXT            -- 自增ID
--   notificationTitle              TEXT           
--   userSessionId                  TEXT            -- 自增ID
--   enableBrotli                   INTEGER        


-- ========================================================
-- 表名: FileMsgInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 8,677

CREATE TABLE FileMsgInfo (  msgSvrId LONG PRIMARY KEY ,  overwriteNewMsgId LONG,  cgi TEXT default '' ,  aeskey TEXT default '' ,  filePath TEXT default '' );

-- 字段说明:
--   msgSvrId                       LONG            -- 消息服务器ID (主键)
--   overwriteNewMsgId              LONG            -- 消息ID (本地)
--   cgi                            TEXT           
--   aeskey                         TEXT            -- AES密钥
--   filePath                       TEXT           


-- ========================================================
-- 表名: ForceNotifyData
-- ========================================================
-- 记录数: 0

CREATE TABLE ForceNotifyData (  ForcePushId TEXT PRIMARY KEY ,  CreateTime LONG,  ExpiredTime LONG,  Description TEXT,  UserIcon TEXT,  UserName TEXT,  ExtInfo TEXT,  Status INTEGER default '0' ,  Type INTEGER default '0' );

-- 字段说明:
--   ForcePushId                    TEXT            -- 自增ID (主键)
--   CreateTime                     LONG            -- 创建时间
--   ExpiredTime                    LONG           
--   Description                    TEXT           
--   UserIcon                       TEXT           
--   UserName                       TEXT            -- 用户名
--   ExtInfo                        TEXT            -- 来源扩展信息
--   Status                         INTEGER         -- 消息状态
--   Type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: FriendUser
-- ========================================================
-- 记录数: 0

CREATE TABLE FriendUser (  encryptUsername TEXT default ''  PRIMARY KEY ,  username TEXT default '' ,  modifyTime LONG default '0' );

-- 字段说明:
--   encryptUsername                TEXT            -- 加密用户名 (主键)
--   username                       TEXT            -- 用户名
--   modifyTime                     LONG            -- 修改时间


-- ========================================================
-- 表名: FunctionMsgItem
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 4

CREATE TABLE FunctionMsgItem (  cgi TEXT,  cmdid INTEGER,  functionmsgid TEXT PRIMARY KEY ,  version LONG,  preVersion LONG,  retryinterval INTEGER,  reportid INTEGER,  successkey INTEGER,  failkey INTEGER,  finalfailkey INTEGER,  custombuff TEXT,  addMsg BLOB,  status INTEGER default '-1' ,  needShow INTEGER default 'false' ,  defaultContent TEXT,  actionTime LONG default '-1' ,  delayTime LONG default '-1' ,  retryCount INTEGER default '0' ,  retryCountLimit INTEGER default '0' ,  businessInfo BLOB,  opCode INTEGER default '-1' ,  addMsgs BLOB);

-- 字段说明:
--   cgi                            TEXT           
--   cmdid                          INTEGER         -- 自增ID
--   functionmsgid                  TEXT            -- 消息ID (本地) (主键)
--   version                        LONG            -- 群信息版本
--   preVersion                     LONG           
--   retryinterval                  INTEGER        
--   reportid                       INTEGER         -- 自增ID
--   successkey                     INTEGER        
--   failkey                        INTEGER        
--   finalfailkey                   INTEGER        
--   custombuff                     TEXT            -- 二进制Buffer
--   addMsg                         BLOB           
--   status                         INTEGER         -- 消息状态
--   needShow                       INTEGER        
--   defaultContent                 TEXT            -- 消息内容
--   actionTime                     LONG           
--   delayTime                      LONG           
--   retryCount                     INTEGER        
--   retryCountLimit                INTEGER        
--   businessInfo                   BLOB           
--   opCode                         INTEGER        
--   addMsgs                        BLOB           


-- ========================================================
-- 表名: GameChatRoomContact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameChatRoomContact (  userName TEXT default ''  PRIMARY KEY ,  roomName TEXT default '' ,  nickName TEXT default '' ,  avatarURL TEXT default '' ,  sex INTEGER default '0' ,  jumpInfo BLOB,  isAuthorized INTEGER default 'true' ,  tagInfo BLOB,  lbsInfo BLOB,  role INTEGER default '0' ,  canBeAt INTEGER default 'true' ,  isRobot INTEGER default 'false' ,  canKickMember INTEGER default 'false' ,  userRole BLOB,  canBeKicked INTEGER default 'true' ,  canAtAll INTEGER default 'false' ,  rawPbData BLOB,  updateTime LONG);

-- 字段说明:
--   userName                       TEXT            -- 用户名 (主键)
--   roomName                       TEXT            -- 群聊名称
--   nickName                       TEXT            -- 昵称
--   avatarURL                      TEXT           
--   sex                            INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   jumpInfo                       BLOB           
--   isAuthorized                   INTEGER        
--   tagInfo                        BLOB           
--   lbsInfo                        BLOB           
--   role                           INTEGER        
--   canBeAt                        INTEGER        
--   isRobot                        INTEGER        
--   canKickMember                  INTEGER        
--   userRole                       BLOB           
--   canBeKicked                    INTEGER        
--   canAtAll                       INTEGER        
--   rawPbData                      BLOB            -- 数据
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: GameHaowanMedia
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameHaowanMedia (  localId TEXT PRIMARY KEY ,  mediaId TEXT,  mediaType INTEGER,  filePath TEXT,  compressPath TEXT,  thumbPath TEXT,  width INTEGER,  height INTEGER,  duration INTEGER,  size LONG,  isGif INTEGER,  mediaUrl TEXT,  thumbPicUrl TEXT,  uploadState INTEGER default 'false' ,  hostTaskId TEXT,  editFlag INTEGER default '0' );

-- 字段说明:
--   localId                        TEXT            -- 消息本地ID (主键)
--   mediaId                        TEXT            -- 自增ID
--   mediaType                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   filePath                       TEXT           
--   compressPath                   TEXT           
--   thumbPath                      TEXT            -- 缩略图路径
--   width                          INTEGER         -- CDN缩略图宽度
--   height                         INTEGER         -- CDN缩略图高度
--   duration                       INTEGER        
--   size                           LONG           
--   isGif                          INTEGER        
--   mediaUrl                       TEXT           
--   thumbPicUrl                    TEXT           
--   uploadState                    INTEGER        
--   hostTaskId                     TEXT            -- 自增ID
--   editFlag                       INTEGER         -- 标记


-- ========================================================
-- 表名: GameHaowanPublishEdition
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameHaowanPublishEdition (  taskId TEXT PRIMARY KEY ,  createTime LONG,  publishSource INTEGER,  mediaType INTEGER,  localIdList TEXT,  mediaList TEXT,  BusinessData TEXT,  uploadState INTEGER default '0' ,  publishState INTEGER default '0' ,  compressImg INTEGER default 'true' ,  mixState INTEGER default '0' ,  bgMixTaskId TEXT,  sourceSceneId INTEGER default '0' );

-- 字段说明:
--   taskId                         TEXT            -- 自增ID (主键)
--   createTime                     LONG            -- 创建时间
--   publishSource                  INTEGER        
--   mediaType                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   localIdList                    TEXT            -- 自增ID
--   mediaList                      TEXT            -- 媒体列表
--   BusinessData                   TEXT            -- 数据
--   uploadState                    INTEGER        
--   publishState                   INTEGER        
--   compressImg                    INTEGER        
--   mixState                       INTEGER        
--   bgMixTaskId                    TEXT            -- 自增ID
--   sourceSceneId                  INTEGER         -- 自增ID


-- ========================================================
-- 表名: GameLifeContact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameLifeContact (  username TEXT default ''  PRIMARY KEY ,  accountType INTEGER default '0' ,  nickname TEXT default '' ,  avatarURL TEXT default '' ,  sex INTEGER default '0' ,  tag TEXT default '' ,  jumpInfo BLOB,  updateTime LONG);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   accountType                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   nickname                       TEXT            -- 昵称
--   avatarURL                      TEXT           
--   sex                            INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   tag                            TEXT           
--   jumpInfo                       BLOB           
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: GameLifeConversation
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameLifeConversation (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  selfUserName TEXT default '' ,  unReadCount INTEGER default '0' ,  updateTime LONG default '0' ,  digest TEXT default '' ,  lastMsgID LONG,  digestFlag LONG default '0' ,  digestPrefix TEXT default '' ,  editingMsg TEXT default '' );

-- 字段说明:
--   sessionId                      TEXT            -- 自增ID (主键)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   selfUserName                   TEXT            -- 用户名
--   unReadCount                    INTEGER        
--   updateTime                     LONG            -- 更新时间
--   digest                         TEXT           
--   lastMsgID                      LONG            -- 消息ID (本地)
--   digestFlag                     LONG            -- 标记
--   digestPrefix                   TEXT           
--   editingMsg                     TEXT           


-- ========================================================
-- 表名: GameLifeSessionInfo
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameLifeSessionInfo (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  selfUserName TEXT default '' ,  extInfo BLOB);

-- 字段说明:
--   sessionId                      TEXT            -- 自增ID (主键)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   selfUserName                   TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息


-- ========================================================
-- 表名: GameLocalVideoInfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameLocalVideoInfo (  fileId TEXT default ''  PRIMARY KEY ,  userId TEXT default '' ,  appId TEXT default '' ,  appName TEXT default '' ,  filePath TEXT default '' ,  orgFilePath TEXT default '' ,  coverPath TEXT default '' ,  extJsonData TEXT default '' ,  createTime LONG,  durationSec LONG,  title TEXT default '' ,  desc TEXT default '' );

-- 字段说明:
--   fileId                         TEXT            -- 自增ID (主键)
--   userId                         TEXT            -- 业务聊天用户ID
--   appId                          TEXT            -- 开放IM应用ID
--   appName                        TEXT           
--   filePath                       TEXT           
--   orgFilePath                    TEXT           
--   coverPath                      TEXT           
--   extJsonData                    TEXT            -- 数据
--   createTime                     LONG            -- 创建时间
--   durationSec                    LONG           
--   title                          TEXT           
--   desc                           TEXT            -- 描述文字ID


-- ========================================================
-- 表名: GameMsgPullRecord
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 10,600

CREATE TABLE GameMsgPullRecord (  dateTimeRange TEXT PRIMARY KEY ,  pullCount INTEGER default '0' );

-- 字段说明:
--   dateTimeRange                  TEXT            (主键)
--   pullCount                      INTEGER        


-- ========================================================
-- 表名: GameMsgRelativeContent
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 206

CREATE TABLE GameMsgRelativeContent (  contentId TEXT PRIMARY KEY ,  consumeMsgId LONG default '0' );

-- 字段说明:
--   contentId                      TEXT            -- 消息内容 (主键)
--   consumeMsgId                   LONG            -- 消息ID (本地)


-- ========================================================
-- 表名: GamePBCache
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 2

CREATE TABLE GamePBCache (  key TEXT PRIMARY KEY ,  value BLOB);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   value                          BLOB           


-- ========================================================
-- 表名: GameRawMessage
-- 说明: 游戏原始消息表
-- ========================================================
-- 记录数: 708

CREATE TABLE GameRawMessage (  msgId LONG PRIMARY KEY ,  mergerId TEXT,  gameMsgId TEXT,  msgType INTEGER,  createTime LONG default '0' ,  expireTime LONG default '0' ,  appId TEXT,  showInMsgList INTEGER default 'true' ,  isRead INTEGER default 'false' ,  label TEXT default '' ,  isHidden INTEGER default 'false' ,  weight TEXT default '' ,  rawXML TEXT default '' ,  receiveTime LONG default '0' ,  showType INTEGER default '0' ,  interactiveMergeId TEXT default '' ,  hasMergedCount INTEGER default '1' ,  redDotExpireTime LONG default '0' ,  needReport INTEGER default 'false' ,  reappearable INTEGER default 'false' ,  entranceExposure INTEGER default 'false' , channel INTEGER default '0', pushId TEXT default '-1', exposuredCount INTEGER default '0', clickScore FLOAT default '0.5', relationType INTEGER default '0', quickResponseContentId TEXT default '', mergeSenderIcon TEXT default '', isGreet INTEGER default 'false', completeExposuredCount INTEGER default '0', reportType INTEGER default '0', contentId TEXT default '', isRedDotExited INTEGER default 'false');

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   mergerId                       TEXT            -- 自增ID
--   gameMsgId                      TEXT            -- 消息ID (本地)
--   msgType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createTime                     LONG            -- 创建时间
--   expireTime                     LONG            -- 过期时间
--   appId                          TEXT            -- 开放IM应用ID
--   showInMsgList                  INTEGER        
--   isRead                         INTEGER        
--   label                          TEXT            -- 联系人标签ID
--   isHidden                       INTEGER         -- 自增ID
--   weight                         TEXT           
--   rawXML                         TEXT            -- XML数据
--   receiveTime                    LONG           
--   showType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   interactiveMergeId             TEXT            -- 自增ID
--   hasMergedCount                 INTEGER        
--   redDotExpireTime               LONG            -- 过期时间
--   needReport                     INTEGER        
--   reappearable                   INTEGER        
--   entranceExposure               INTEGER        
--   channel                        INTEGER        
--   pushId                         TEXT            -- 自增ID
--   exposuredCount                 INTEGER        
--   clickScore                     FLOAT          
--   relationType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   quickResponseContentId         TEXT            -- 消息内容
--   mergeSenderIcon                TEXT           
--   isGreet                        INTEGER        
--   completeExposuredCount         INTEGER        
--   reportType                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   contentId                      TEXT            -- 消息内容
--   isRedDotExited                 INTEGER        


-- ========================================================
-- 表名: GameResourceDownload
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameResourceDownload (  packageName TEXT PRIMARY KEY ,  appId TEXT,  intervalSeconds INTEGER,  expiredSeconds INTEGER,  createTime LONG,  checkCgiTime LONG,  finishDownloadTime LONG,  downloadItemList BLOB, taskExpiredSeconds LONG, scene INTEGER);

-- 字段说明:
--   packageName                    TEXT            (主键)
--   appId                          TEXT            -- 开放IM应用ID
--   intervalSeconds                INTEGER        
--   expiredSeconds                 INTEGER        
--   createTime                     LONG            -- 创建时间
--   checkCgiTime                   LONG           
--   finishDownloadTime             LONG           
--   downloadItemList               BLOB           
--   taskExpiredSeconds             LONG           
--   scene                          INTEGER        


-- ========================================================
-- 表名: GameSilentDownload
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameSilentDownload (  appId TEXT PRIMARY KEY ,  downloadUrl TEXT,  size LONG default '0' ,  md5 TEXT,  packageName TEXT,  expireTime LONG default '0' ,  randomTime LONG default '0' ,  isFirst INTEGER default 'true' ,  nextCheckTime LONG default '0' ,  isRunning INTEGER default 'false' ,  noWifi INTEGER default 'true' ,  noSdcard INTEGER default 'true' ,  noEnoughSpace INTEGER default 'true' ,  lowBattery INTEGER default 'true' ,  continueDelay INTEGER default 'true' ,  SecondaryUrl TEXT,  downloadInWidget INTEGER,  sectionMd5Byte BLOB,  forceUpdateFlag INTEGER default '0' , downloadScene INTEGER default '0');

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   downloadUrl                    TEXT           
--   size                           LONG           
--   md5                            TEXT            -- MD5值
--   packageName                    TEXT           
--   expireTime                     LONG            -- 过期时间
--   randomTime                     LONG           
--   isFirst                        INTEGER        
--   nextCheckTime                  LONG            -- 扩展
--   isRunning                      INTEGER        
--   noWifi                         INTEGER        
--   noSdcard                       INTEGER        
--   noEnoughSpace                  INTEGER        
--   lowBattery                     INTEGER        
--   continueDelay                  INTEGER        
--   SecondaryUrl                   TEXT           
--   downloadInWidget               INTEGER         -- 自增ID
--   sectionMd5Byte                 BLOB            -- MD5值
--   forceUpdateFlag                INTEGER         -- 标记
--   downloadScene                  INTEGER        


-- ========================================================
-- 表名: GameSimpleUserInfo
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GameSimpleUserInfo (  compositionKey TEXT default ''  PRIMARY KEY ,  userName TEXT default '' ,  roomName TEXT default '' ,  nickName TEXT default '' ,  avatarURL TEXT default '' ,  role INTEGER default '0' ,  updateTime LONG);

-- 字段说明:
--   compositionKey                 TEXT            (主键)
--   userName                       TEXT            -- 用户名
--   roomName                       TEXT            -- 群聊名称
--   nickName                       TEXT            -- 昵称
--   avatarURL                      TEXT           
--   role                           INTEGER        
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: GetEmotionListCache
-- ========================================================
-- 记录数: 5

CREATE TABLE GetEmotionListCache (  reqType TEXT PRIMARY KEY ,  cache BLOB default '' );

-- 字段说明:
--   reqType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息) (主键)
--   cache                          BLOB           


-- ========================================================
-- 表名: GetEmotionStoreRecListCache
-- ========================================================
-- 记录数: 0

CREATE TABLE GetEmotionStoreRecListCache (  reqType TEXT PRIMARY KEY ,  cache BLOB default '' );

-- 字段说明:
--   reqType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息) (主键)
--   cache                          BLOB           


-- ========================================================
-- 表名: GetSysCmdMsgInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE GetSysCmdMsgInfo (  originSvrId LONG PRIMARY KEY ,  newMsgId LONG,  fromUserName TEXT default '' ,  toUserName TEXT default '' ,  createTime LONG default '0' ,  content TEXT default '' ,  msgSource TEXT default '' ,  msgSeq INTEGER,  flag INTEGER,  reserved1 INTEGER,  reserved2 LONG,  reserved3 TEXT default '' ,  reserved4 TEXT default '' );

-- 字段说明:
--   originSvrId                    LONG            -- 自增ID (主键)
--   newMsgId                       LONG            -- 消息ID (本地)
--   fromUserName                   TEXT            -- 用户名
--   toUserName                     TEXT            -- 用户名
--   createTime                     LONG            -- 创建时间
--   content                        TEXT            -- 消息内容
--   msgSource                      TEXT           
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INTEGER         -- 标记
--   reserved1                      INTEGER         -- 保留字段1
--   reserved2                      LONG            -- 保留字段2
--   reserved3                      TEXT            -- 保留字段3
--   reserved4                      TEXT            -- 保留字段4


-- ========================================================
-- 表名: GoogleFriend
-- ========================================================
-- 记录数: 0

CREATE TABLE GoogleFriend (  googleid TEXT,  googlename TEXT,  googlephotourl TEXT,  googlegmail TEXT,  username TEXT,  nickname TEXT,  nicknameqp TEXT,  usernamepy TEXT,  small_url TEXT,  big_url TEXT,  ret INTEGER,  status INTEGER,  googleitemid TEXT PRIMARY KEY ,  googlecgistatus INTEGER default '2' ,  contecttype TEXT,  googlenamepy TEXT);

-- 字段说明:
--   googleid                       TEXT            -- 自增ID
--   googlename                     TEXT           
--   googlephotourl                 TEXT           
--   googlegmail                    TEXT           
--   username                       TEXT            -- 用户名
--   nickname                       TEXT            -- 昵称
--   nicknameqp                     TEXT            -- 昵称
--   usernamepy                     TEXT            -- 用户名
--   small_url                      TEXT           
--   big_url                        TEXT           
--   ret                            INTEGER         -- 过期时间
--   status                         INTEGER         -- 消息状态
--   googleitemid                   TEXT            -- 自增ID (主键)
--   googlecgistatus                INTEGER         -- 消息状态
--   contecttype                    TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   googlenamepy                   TEXT           


-- ========================================================
-- 表名: GroupBindApp
-- ========================================================
-- 记录数: 19

CREATE TABLE GroupBindApp (  chatRoomName TEXT default '群username'  PRIMARY KEY ,  BindAppData BLOB);

-- 字段说明:
--   chatRoomName                   TEXT            -- 群聊名称 (主键)
--   BindAppData                    BLOB            -- 数据


-- ========================================================
-- 表名: GroupSolitatire
-- ========================================================
-- 记录数: 42

CREATE TABLE GroupSolitatire (  username TEXT,  key TEXT,  content TEXT,  creator TEXT,  num INTEGER,  firstMsgId LONG,  msgSvrId LONG,  active INTEGER default '-1' ,  lastActiveTime LONG);

-- 字段说明:
--   username                       TEXT            -- 用户名
--   key                            TEXT            -- AES密钥
--   content                        TEXT            -- 消息内容
--   creator                        TEXT           
--   num                            INTEGER        
--   firstMsgId                     LONG            -- 消息ID (本地)
--   msgSvrId                       LONG            -- 消息服务器ID
--   active                         INTEGER        
--   lastActiveTime                 LONG           


-- ========================================================
-- 表名: GroupTodo
-- ========================================================
-- 记录数: 430

CREATE TABLE GroupTodo (  todoid TEXT,  roomname TEXT,  username TEXT,  path TEXT,  createtime LONG,  updatetime LONG,  custominfo TEXT default '' ,  title TEXT default '' ,  creator TEXT,  related_msgids TEXT,  manager TEXT,  nreply INTEGER,  state INTEGER,  netSceneState INTEGER,  shareKey TEXT,  shareName TEXT);

-- 字段说明:
--   todoid                         TEXT            -- 自增ID
--   roomname                       TEXT            -- 群聊名称
--   username                       TEXT            -- 用户名
--   path                           TEXT            -- 图片路径
--   createtime                     LONG            -- 创建时间
--   updatetime                     LONG            -- 更新时间
--   custominfo                     TEXT           
--   title                          TEXT           
--   creator                        TEXT           
--   related_msgids                 TEXT            -- 消息ID (本地)
--   manager                        TEXT           
--   nreply                         INTEGER        
--   state                          INTEGER        
--   netSceneState                  INTEGER        
--   shareKey                       TEXT           
--   shareName                      TEXT           


-- ========================================================
-- 表名: GroupTools
-- ========================================================
-- 记录数: 522

CREATE TABLE GroupTools (  chatroomname TEXT PRIMARY KEY ,  stickToollist TEXT,  recentUseToolList TEXT,  queryState INTEGER);

-- 字段说明:
--   chatroomname                   TEXT            -- 群聊名称 (主键)
--   stickToollist                  TEXT           
--   recentUseToolList              TEXT           
--   queryState                     INTEGER        


-- ========================================================
-- 表名: HardDeviceChampionInfo
-- ========================================================
-- 记录数: 16

CREATE TABLE HardDeviceChampionInfo (  username TEXT,  championUrl TEXT,  championMotto TEXT);

-- 字段说明:
--   username                       TEXT            -- 用户名
--   championUrl                    TEXT           
--   championMotto                  TEXT           


-- ========================================================
-- 表名: HardDeviceInfo
-- 说明: 硬件设备信息表
-- ========================================================
-- 记录数: 2

CREATE TABLE HardDeviceInfo (  deviceID TEXT PRIMARY KEY ,  brandName TEXT,  mac LONG,  deviceType TEXT,  connProto TEXT,  connStrategy INTEGER,  closeStrategy INTEGER,  md5Str TEXT,  authKey TEXT,  url TEXT,  sessionKey BLOB,  sessionBuf BLOB,  authBuf BLOB,  lvbuffer BLOB);

-- 字段说明:
--   deviceID                       TEXT            -- 自增ID (主键)
--   brandName                      TEXT           
--   mac                            LONG           
--   deviceType                     TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   connProto                      TEXT           
--   connStrategy                   INTEGER        
--   closeStrategy                  INTEGER        
--   md5Str                         TEXT            -- MD5值
--   authKey                        TEXT           
--   url                            TEXT            -- CDN大图URL
--   sessionKey                     BLOB           
--   sessionBuf                     BLOB            -- 二进制Buffer
--   authBuf                        BLOB            -- 二进制Buffer
--   lvbuffer                       BLOB            -- 二进制数据


-- ========================================================
-- 表名: HardDeviceLikeUser
-- ========================================================
-- 记录数: 24

CREATE TABLE HardDeviceLikeUser (  rankID TEXT,  appusername TEXT,  username TEXT,  timestamp INTEGER default '0' ,  liketips TEXT default '' );

-- 字段说明:
--   rankID                         TEXT            -- 自增ID
--   appusername                    TEXT            -- 用户名
--   username                       TEXT            -- 用户名
--   timestamp                      INTEGER        
--   liketips                       TEXT           


-- ========================================================
-- 表名: HardDeviceProfileRankDetail
-- ========================================================
-- 记录数: 0

CREATE TABLE HardDeviceProfileRankDetail (  appusername TEXT,  title TEXT,  score INTEGER);

-- 字段说明:
--   appusername                    TEXT            -- 用户名
--   title                          TEXT           
--   score                          INTEGER        


-- ========================================================
-- 表名: HardDeviceRankFollowInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE HardDeviceRankFollowInfo (  appusername TEXT,  rankID TEXT,  username TEXT,  step INTEGER,  sort INTEGER default '0' );

-- 字段说明:
--   appusername                    TEXT            -- 用户名
--   rankID                         TEXT            -- 自增ID
--   username                       TEXT            -- 用户名
--   step                           INTEGER        
--   sort                           INTEGER        


-- ========================================================
-- 表名: HardDeviceRankInfo
-- ========================================================
-- 记录数: 13,766

CREATE TABLE HardDeviceRankInfo (  rankID TEXT,  appusername TEXT,  username TEXT,  ranknum INTEGER,  score INTEGER,  likecount INTEGER default '0' ,  selfLikeState INTEGER default '3' ,  sportRecord BLOB);

-- 字段说明:
--   rankID                         TEXT            -- 自增ID
--   appusername                    TEXT            -- 用户名
--   username                       TEXT            -- 用户名
--   ranknum                        INTEGER        
--   score                          INTEGER        
--   likecount                      INTEGER         -- 点赞数
--   selfLikeState                  INTEGER        
--   sportRecord                    BLOB           


-- ========================================================
-- 表名: HardIotCdnInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE HardIotCdnInfo (  msgid LONG PRIMARY KEY ,  fileid TEXT,  aeskey TEXT,  md5 TEXT,  size INTEGER,  talker TEXT);

-- 字段说明:
--   msgid                          LONG            -- 消息ID (本地) (主键)
--   fileid                         TEXT            -- 自增ID
--   aeskey                         TEXT            -- AES密钥
--   md5                            TEXT            -- MD5值
--   size                           INTEGER        
--   talker                         TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: HardIotDeviceInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE HardIotDeviceInfo (  deviceId TEXT PRIMARY KEY ,  deviceType INTEGER,  nickName TEXT,  iconUrl TEXT,  supportMsgTypeList TEXT, productType INTEGER);

-- 字段说明:
--   deviceId                       TEXT            -- 自增ID (主键)
--   deviceType                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   nickName                       TEXT            -- 昵称
--   iconUrl                        TEXT           
--   supportMsgTypeList             TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   productType                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: HoneyPayMsgRecord
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 2

CREATE TABLE HoneyPayMsgRecord (  payMsgId TEXT PRIMARY KEY ,  msgId LONG);

-- 字段说明:
--   payMsgId                       TEXT            -- 消息ID (本地) (主键)
--   msgId                          LONG            -- 消息ID (本地)


-- ========================================================
-- 表名: ILinkResourceInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ILinkResourceInfo (  projectId TEXT,  resourceName TEXT,  resourceVersion INTEGER,  resourceSize INTEGER,  md5 TEXT,  url TEXT,  createTime LONG);

-- 字段说明:
--   projectId                      TEXT            -- 自增ID
--   resourceName                   TEXT           
--   resourceVersion                INTEGER        
--   resourceSize                   INTEGER        
--   md5                            TEXT            -- MD5值
--   url                            TEXT            -- CDN大图URL
--   createTime                     LONG            -- 创建时间


-- ========================================================
-- 表名: IPCallAddressItem
-- ========================================================
-- 记录数: 0

CREATE TABLE IPCallAddressItem (  wechatUsername TEXT,  systemAddressBookUsername TEXT,  contactId TEXT,  sortKey TEXT);

-- 字段说明:
--   wechatUsername                 TEXT            -- 用户名
--   systemAddressBookUsername      TEXT            -- 用户名
--   contactId                      TEXT            -- 自增ID
--   sortKey                        TEXT           


-- ========================================================
-- 表名: IPCallMsg
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE IPCallMsg (  svrId LONG PRIMARY KEY ,  isRead SHORT default '0' ,  title TEXT,  content TEXT,  pushTime LONG,  msgType INTEGER,  descUrl TEXT);

-- 字段说明:
--   svrId                          LONG            -- 消息服务器ID (主键)
--   isRead                         SHORT          
--   title                          TEXT           
--   content                        TEXT            -- 消息内容
--   pushTime                       LONG           
--   msgType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   descUrl                        TEXT           


-- ========================================================
-- 表名: IPCallPopularCountry
-- ========================================================
-- 记录数: 8

CREATE TABLE IPCallPopularCountry (  countryCode INTEGER PRIMARY KEY ,  callTimeCount LONG,  lastCallTime LONG);

-- 字段说明:
--   countryCode                    INTEGER         -- 国家 (主键)
--   callTimeCount                  LONG           
--   lastCallTime                   LONG           


-- ========================================================
-- 表名: IPCallRecord
-- ========================================================
-- 记录数: 0

CREATE TABLE IPCallRecord (  phonenumber TEXT,  calltime LONG,  duration LONG,  status INTEGER,  addressId LONG default '-1' ,  phoneType INTEGER default '-1' );

-- 字段说明:
--   phonenumber                    TEXT           
--   calltime                       LONG           
--   duration                       LONG           
--   status                         INTEGER         -- 消息状态
--   addressId                      LONG            -- 自增ID
--   phoneType                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: ImgInfo
-- 说明: 图片相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE ImgInfo ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT );

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径


-- ========================================================
-- 表名: ImgInfo2
-- 说明: 图片信息表 - 存储图片消息详情
-- ========================================================
-- 记录数: 200,967

CREATE TABLE ImgInfo2 ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0 , originSourceMd5 TEXT, msgTalker TEXT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   originSourceMd5                TEXT            -- MD5值
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: JsLogBlockList
-- ========================================================
-- 记录数: 0

CREATE TABLE JsLogBlockList (  logId INTEGER PRIMARY KEY ,  liftTime LONG);

-- 字段说明:
--   logId                          INTEGER         -- 自增ID (主键)
--   liftTime                       LONG           


-- ========================================================
-- 表名: KindaCacheTable
-- 说明: AB测试相关表
-- ========================================================
-- 记录数: 34

CREATE TABLE KindaCacheTable (  key TEXT PRIMARY KEY ,  value BLOB,  expire_at LONG);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   value                          BLOB           
--   expire_at                      LONG           


-- ========================================================
-- 表名: LBSVerifyMessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE LBSVerifyMessage (  svrid LONG default '0'  PRIMARY KEY ,  status INTEGER,  type INTEGER,  scene INTEGER,  createtime LONG,  talker TEXT,  content TEXT,  sayhiuser TEXT,  sayhicontent TEXT,  imgpath TEXT,  isSend INTEGER,  sayhiencryptuser TEXT,  ticket TEXT,  flag INTEGER);

-- 字段说明:
--   svrid                          LONG            -- 消息服务器ID (主键)
--   status                         INTEGER         -- 消息状态
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   scene                          INTEGER        
--   createtime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   sayhiuser                      TEXT           
--   sayhicontent                   TEXT            -- 消息内容
--   imgpath                        TEXT            -- 图片路径
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   sayhiencryptuser               TEXT           
--   ticket                         TEXT            -- 票据
--   flag                           INTEGER         -- 标记


-- ========================================================
-- 表名: LabAppInfo
-- 说明: AB测试相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE LabAppInfo (  LabsAppId TEXT PRIMARY KEY ,  expId TEXT default '' ,  Type INTEGER default '0' ,  BizType INTEGER default '0' ,  Switch INTEGER default '0' ,  AllVer INTEGER default '0' ,  DetailURL TEXT,  WeAppUser TEXT,  WeAppPath TEXT,  Pos INTEGER default '0' ,  TitleKey_android TEXT,  Title_cn TEXT,  Title_hk TEXT,  Title_tw TEXT,  Title_en TEXT,  Desc_cn TEXT,  Desc_hk TEXT,  Desc_tw TEXT,  Desc_en TEXT,  Introduce_cn TEXT,  Introduce_hk TEXT,  Introduce_tw TEXT,  Introduce_en TEXT,  starttime LONG,  endtime LONG,  sequence LONG,  prioritylevel INTEGER,  status INTEGER,  ThumbUrl_cn TEXT,  ThumbUrl_hk TEXT,  ThumbUrl_tw TEXT,  ThumbUrl_en TEXT,  ImgUrl_android_cn TEXT,  ImgUrl_android_hk TEXT,  ImgUrl_android_tw TEXT,  ImgUrl_android_en TEXT,  RedPoint INTEGER,  WeAppDebugMode INTEGER,  idkey INTEGER,  idkeyValue INTEGER,  Icon TEXT,  ImgUrl_cn TEXT,  ImgUrl_hk TEXT,  ImgUrl_tw TEXT,  ImgUrl_en TEXT,  bItemFromXExpt INTEGER);

-- 字段说明:
--   LabsAppId                      TEXT            -- 自增ID (主键)
--   expId                          TEXT            -- 自增ID
--   Type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   BizType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   Switch                         INTEGER        
--   AllVer                         INTEGER        
--   DetailURL                      TEXT           
--   WeAppUser                      TEXT           
--   WeAppPath                      TEXT           
--   Pos                            INTEGER        
--   TitleKey_android               TEXT            -- 自增ID
--   Title_cn                       TEXT           
--   Title_hk                       TEXT           
--   Title_tw                       TEXT           
--   Title_en                       TEXT           
--   Desc_cn                        TEXT           
--   Desc_hk                        TEXT           
--   Desc_tw                        TEXT           
--   Desc_en                        TEXT           
--   Introduce_cn                   TEXT           
--   Introduce_hk                   TEXT           
--   Introduce_tw                   TEXT           
--   Introduce_en                   TEXT           
--   starttime                      LONG            -- 开始时间
--   endtime                        LONG            -- 结束时间
--   sequence                       LONG           
--   prioritylevel                  INTEGER        
--   status                         INTEGER         -- 消息状态
--   ThumbUrl_cn                    TEXT           
--   ThumbUrl_hk                    TEXT           
--   ThumbUrl_tw                    TEXT           
--   ThumbUrl_en                    TEXT           
--   ImgUrl_android_cn              TEXT            -- 自增ID
--   ImgUrl_android_hk              TEXT            -- 自增ID
--   ImgUrl_android_tw              TEXT            -- 自增ID
--   ImgUrl_android_en              TEXT            -- 自增ID
--   RedPoint                       INTEGER        
--   WeAppDebugMode                 INTEGER        
--   idkey                          INTEGER         -- 自增ID
--   idkeyValue                     INTEGER         -- 自增ID
--   Icon                           TEXT           
--   ImgUrl_cn                      TEXT           
--   ImgUrl_hk                      TEXT           
--   ImgUrl_tw                      TEXT           
--   ImgUrl_en                      TEXT           
--   bItemFromXExpt                 INTEGER        


-- ========================================================
-- 表名: LiteAppAuthInfo
-- ========================================================
-- 记录数: 14

CREATE TABLE LiteAppAuthInfo (  host TEXT PRIMARY KEY ,  param TEXT,  headerMap TEXT,  paramMap TEXT,  updateTime LONG);

-- 字段说明:
--   host                           TEXT            (主键)
--   param                          TEXT           
--   headerMap                      TEXT           
--   paramMap                       TEXT           
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: LiteAppBaselibInfo
-- ========================================================
-- 记录数: 1

CREATE TABLE LiteAppBaselibInfo (  majorVersion TEXT PRIMARY KEY ,  signatureKey TEXT,  pkgPath TEXT,  pkgType TEXT,  patchId TEXT,  updateTime LONG,  url TEXT,  md5 TEXT,  lastUseTime LONG, iLinkVersion INTEGER, version TEXT);

-- 字段说明:
--   majorVersion                   TEXT            (主键)
--   signatureKey                   TEXT            -- 个性签名
--   pkgPath                        TEXT           
--   pkgType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   patchId                        TEXT            -- 自增ID
--   updateTime                     LONG            -- 更新时间
--   url                            TEXT            -- CDN大图URL
--   md5                            TEXT            -- MD5值
--   lastUseTime                    LONG           
--   iLinkVersion                   INTEGER        
--   version                        TEXT            -- 群信息版本


-- ========================================================
-- 表名: LiteAppConfigInfo
-- ========================================================
-- 记录数: 47

CREATE TABLE LiteAppConfigInfo (  appId TEXT PRIMARY KEY ,  signatureKey TEXT,  packageConfigPath TEXT,  updateTime LONG,  md5 TEXT,  dynamicConfigPath TEXT,  iLinkVersion INTEGER,  configJson TEXT);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   signatureKey                   TEXT            -- 个性签名
--   packageConfigPath              TEXT           
--   updateTime                     LONG            -- 更新时间
--   md5                            TEXT            -- MD5值
--   dynamicConfigPath              TEXT           
--   iLinkVersion                   INTEGER        
--   configJson                     TEXT           


-- ========================================================
-- 表名: LiteAppInfo
-- ========================================================
-- 记录数: 44

CREATE TABLE LiteAppInfo (  appId TEXT PRIMARY KEY ,  groupId TEXT,  signatureKey TEXT,  pkgPath TEXT,  pkgType TEXT,  patchId TEXT,  updateTime LONG,  version TEXT,  url TEXT,  md5 TEXT,  lastUseTime LONG, iLinkVersion INTEGER, openOption TEXT);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   groupId                        TEXT            -- 自增ID
--   signatureKey                   TEXT            -- 个性签名
--   pkgPath                        TEXT           
--   pkgType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   patchId                        TEXT            -- 自增ID
--   updateTime                     LONG            -- 更新时间
--   version                        TEXT            -- 群信息版本
--   url                            TEXT            -- CDN大图URL
--   md5                            TEXT            -- MD5值
--   lastUseTime                    LONG           
--   iLinkVersion                   INTEGER        
--   openOption                     TEXT           


-- ========================================================
-- 表名: LiveTipsBar
-- ========================================================
-- 记录数: 0

CREATE TABLE LiveTipsBar (  liveId LONG default '0'  PRIMARY KEY ,  hostRoomId TEXT default '' ,  liveName TEXT default '' ,  thumbUrl TEXT default '' ,  anchorUsername TEXT default '' ,  isSender INTEGER default 'false' ,  timeStamp LONG default '0' );

-- 字段说明:
--   liveId                         LONG            -- 自增ID (主键)
--   hostRoomId                     TEXT            -- 自增ID
--   liveName                       TEXT           
--   thumbUrl                       TEXT            -- CDN缩略图URL
--   anchorUsername                 TEXT            -- 用户名
--   isSender                       INTEGER         -- 是否发送 (0=接收, 1=发送)
--   timeStamp                      LONG           


-- ========================================================
-- 表名: LoanEntryInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE LoanEntryInfo (  title TEXT PRIMARY KEY ,  loan_jump_url TEXT,  red_dot_index INTEGER,  is_show_entry INTEGER,  tips TEXT,  is_overdue INTEGER,  available_otb TEXT);

-- 字段说明:
--   title                          TEXT            (主键)
--   loan_jump_url                  TEXT           
--   red_dot_index                  INTEGER        
--   is_show_entry                  INTEGER        
--   tips                           TEXT           
--   is_overdue                     INTEGER        
--   available_otb                  TEXT           


-- ========================================================
-- 表名: LocalGameReport
-- 说明: 游戏相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE LocalGameReport (  pkgName TEXT PRIMARY KEY ,  lastReportTimeStamp LONG);

-- 字段说明:
--   pkgName                        TEXT            (主键)
--   lastReportTimeStamp            LONG           


-- ========================================================
-- 表名: LocalLiteAppConf
-- ========================================================
-- 记录数: 1

CREATE TABLE LocalLiteAppConf (  url TEXT PRIMARY KEY ,  appid TEXT,  path TEXT,  expire_duration INTEGER,  refresh_duration INTEGER,  wepkg_id TEXT,  updateTime LONG,  hasLiteConf INTEGER default 'false' );

-- 字段说明:
--   url                            TEXT            -- CDN大图URL (主键)
--   appid                          TEXT            -- 开放IM应用ID
--   path                           TEXT            -- 图片路径
--   expire_duration                INTEGER        
--   refresh_duration               INTEGER        
--   wepkg_id                       TEXT            -- 自增ID
--   updateTime                     LONG            -- 更新时间
--   hasLiteConf                    INTEGER        


-- ========================================================
-- 表名: LocalRedPacketStoryInfo
-- ========================================================
-- 记录数: 34

CREATE TABLE LocalRedPacketStoryInfo (  title TEXT,  logo_url TEXT,  logo_md5 TEXT,  description TEXT,  corp_name TEXT,  action_type INTEGER,  action_url TEXT,  action_app_username TEXT,  action_app_nickname TEXT,  packet_id TEXT PRIMARY KEY ,  update_time LONG,  subtype_id INTEGER,  action_emotion_designer_uin INTEGER,  action_jump_text TEXT,  same_receive_link TEXT, detail_dynamic_url TEXT, action_before_jump_text TEXT, action_dark_icon_url TEXT, action_normal_icon_url TEXT, joint_label_text TEXT, wxapp_info_app_name TEXT, wxapp_info_wording TEXT, wxapp_info_app_path TEXT, wxapp_info_icon_url TEXT, detail_image_url_md5 TEXT, detail_atmosphere_pag_url TEXT, detail_image_url TEXT, outer_jump_action_jump_newlife INTEGER, outer_jump_action_jump_text TEXT, outer_jump_action_type INTEGER, outer_jump_action_app_username TEXT, ecs_jump_info_str TEXT);

-- 字段说明:
--   title                          TEXT           
--   logo_url                       TEXT           
--   logo_md5                       TEXT            -- MD5值
--   description                    TEXT           
--   corp_name                      TEXT           
--   action_type                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   action_url                     TEXT           
--   action_app_username            TEXT            -- 用户名
--   action_app_nickname            TEXT            -- 昵称
--   packet_id                      TEXT            -- 自增ID (主键)
--   update_time                    LONG           
--   subtype_id                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   action_emotion_designer_uin    INTEGER        
--   action_jump_text               TEXT            -- 扩展
--   same_receive_link              TEXT           
--   detail_dynamic_url             TEXT           
--   action_before_jump_text        TEXT            -- 扩展
--   action_dark_icon_url           TEXT           
--   action_normal_icon_url         TEXT           
--   joint_label_text               TEXT            -- 扩展
--   wxapp_info_app_name            TEXT           
--   wxapp_info_wording             TEXT           
--   wxapp_info_app_path            TEXT           
--   wxapp_info_icon_url            TEXT           
--   detail_image_url_md5           TEXT            -- MD5值
--   detail_atmosphere_pag_url      TEXT           
--   detail_image_url               TEXT           
--   outer_jump_action_jump_newlife INTEGER        
--   outer_jump_action_jump_text    TEXT            -- 扩展
--   outer_jump_action_type         INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   outer_jump_action_app_username TEXT            -- 用户名
--   ecs_jump_info_str              TEXT           


-- ========================================================
-- 表名: LocalStoryDetail
-- ========================================================
-- 记录数: 44

CREATE TABLE LocalStoryDetail (  media_type INTEGER,  media_url TEXT,  media_md5 TEXT,  height INTEGER,  width INTEGER,  packet_id TEXT,  media_fuzzy_thumbnail_url TEXT,  media_fuzzy_thumbnail_md5 TEXT);

-- 字段说明:
--   media_type                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   media_url                      TEXT           
--   media_md5                      TEXT            -- MD5值
--   height                         INTEGER         -- CDN缩略图高度
--   width                          INTEGER         -- CDN缩略图宽度
--   packet_id                      TEXT            -- 自增ID
--   media_fuzzy_thumbnail_url      TEXT           
--   media_fuzzy_thumbnail_md5      TEXT            -- MD5值


-- ========================================================
-- 表名: LuckyMoneyDetailOpenRecord
-- ========================================================
-- 记录数: 6,177

CREATE TABLE LuckyMoneyDetailOpenRecord (  send_id TEXT PRIMARY KEY ,  open_count INTEGER);

-- 字段说明:
--   send_id                        TEXT            -- 自增ID (主键)
--   open_count                     INTEGER        


-- ========================================================
-- 表名: LuckyMoneyEnvelopeResource
-- ========================================================
-- 记录数: 23

CREATE TABLE LuckyMoneyEnvelopeResource (  subtype INTEGER PRIMARY KEY ,  bubbleMd5 TEXT,  coverMd5 TEXT,  minilogoMd5 TEXT,  detailMd5 TEXT,  version INTEGER,  bubblewidgetMd5 TEXT,  coverwidgetMd5 TEXT, bubbledynamicMd5 TEXT);

-- 字段说明:
--   subtype                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息) (主键)
--   bubbleMd5                      TEXT            -- MD5值
--   coverMd5                       TEXT            -- MD5值
--   minilogoMd5                    TEXT            -- MD5值
--   detailMd5                      TEXT            -- MD5值
--   version                        INTEGER         -- 群信息版本
--   bubblewidgetMd5                TEXT            -- 自增ID
--   coverwidgetMd5                 TEXT            -- 自增ID
--   bubbledynamicMd5               TEXT            -- MD5值


-- ========================================================
-- 表名: MagicPkgInfo
-- ========================================================
-- 记录数: 9

CREATE TABLE MagicPkgInfo (  pkgId TEXT PRIMARY KEY ,  pkgPath TEXT,  unZipPath TEXT,  pkgType INTEGER,  patchId TEXT,  updateTime LONG,  version TEXT,  url TEXT,  md5 TEXT,  lastUseTime LONG, wxaPkgPath TEXT, originalName TEXT);

-- 字段说明:
--   pkgId                          TEXT            -- 自增ID (主键)
--   pkgPath                        TEXT           
--   unZipPath                      TEXT           
--   pkgType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   patchId                        TEXT            -- 自增ID
--   updateTime                     LONG            -- 更新时间
--   version                        TEXT            -- 群信息版本
--   url                            TEXT            -- CDN大图URL
--   md5                            TEXT            -- MD5值
--   lastUseTime                    LONG           
--   wxaPkgPath                     TEXT           
--   originalName                   TEXT           


-- ========================================================
-- 表名: MediaDuplication
-- ========================================================
-- 记录数: 2,552

CREATE TABLE MediaDuplication  (md5 text , size int , path text , createtime long, remuxing text, duration int, status int);

-- 字段说明:
--   md5                            text            -- MD5值
--   size                           int            
--   path                           text            -- 图片路径
--   createtime                     long            -- 创建时间
--   remuxing                       text           
--   duration                       int            
--   status                         int             -- 消息状态


-- ========================================================
-- 表名: MsgQuote
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 31,364

CREATE TABLE MsgQuote (  msgId LONG,  msgSvrId LONG,  quotedMsgId LONG,  quotedMsgSvrId LONG,  status INTEGER, quotedMsgTalker TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地)
--   msgSvrId                       LONG            -- 消息服务器ID
--   quotedMsgId                    LONG            -- 消息ID (本地)
--   quotedMsgSvrId                 LONG            -- 消息服务器ID
--   status                         INTEGER         -- 消息状态
--   quotedMsgTalker                TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: MultiTalkInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE MultiTalkInfo (  wxGroupId TEXT PRIMARY KEY ,  groupId TEXT,  roomId INTEGER,  roomKey LONG,  routeId INTEGER,  inviteUserName TEXT,  memberCount INTEGER,  createTime LONG,  state INTEGER default '0' ,  ilinkRoomId LONG);

-- 字段说明:
--   wxGroupId                      TEXT            -- 自增ID (主键)
--   groupId                        TEXT            -- 自增ID
--   roomId                         INTEGER         -- 自增ID
--   roomKey                        LONG           
--   routeId                        INTEGER         -- 自增ID
--   inviteUserName                 TEXT            -- 用户名
--   memberCount                    INTEGER         -- 成员数量
--   createTime                     LONG            -- 创建时间
--   state                          INTEGER        
--   ilinkRoomId                    LONG            -- 自增ID


-- ========================================================
-- 表名: MultiTalkMember
-- ========================================================
-- 记录数: 0

CREATE TABLE MultiTalkMember (  memberUuid LONG,  wxGroupId TEXT,  userName TEXT,  inviteUserName TEXT,  memberId LONG,  status INTEGER,  createTime LONG);

-- 字段说明:
--   memberUuid                     LONG            -- 自增ID
--   wxGroupId                      TEXT            -- 自增ID
--   userName                       TEXT            -- 用户名
--   inviteUserName                 TEXT            -- 用户名
--   memberId                       LONG            -- 自增ID
--   status                         INTEGER         -- 消息状态
--   createTime                     LONG            -- 创建时间


-- ========================================================
-- 表名: MultiTaskInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE MultiTaskInfo (  id TEXT PRIMARY KEY ,  type INTEGER default '0' ,  createTime LONG default '0' ,  updateTime LONG default '0' ,  showData BLOB,  data BLOB default '' );

-- 字段说明:
--   id                             TEXT            -- 自增ID (主键)
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createTime                     LONG            -- 创建时间
--   updateTime                     LONG            -- 更新时间
--   showData                       BLOB            -- 数据
--   data                           BLOB            -- 数据


-- ========================================================
-- 表名: Music
-- ========================================================
-- 记录数: 0

CREATE TABLE Music (  musicId TEXT PRIMARY KEY ,  originMusicId TEXT,  musicType INTEGER,  downloadedLength LONG,  wifiDownloadedLength LONG,  endFlag INTEGER,  wifiEndFlag INTEGER,  updateTime LONG,  songId INTEGER,  songName TEXT,  songSinger TEXT,  songAlbum TEXT,  songAlbumType INTEGER,  songAlbumUrl TEXT,  songHAlbumUrl TEXT,  songAlbumLocalPath TEXT,  songWifiUrl TEXT,  songWapLinkUrl TEXT,  songWebUrl TEXT,  appId TEXT,  songMediaId TEXT,  songSnsAlbumUser TEXT,  songSnsShareUser TEXT,  songLyric TEXT,  songBgColor INTEGER,  songLyricColor INTEGER,  songFileLength LONG,  songWifiFileLength LONG,  hideBanner INTEGER,  jsWebUrlDomain TEXT,  isBlock INTEGER,  startTime INTEGER,  mimetype TEXT,  protocol TEXT,  barBackToWebView INTEGER,  musicbar_url TEXT,  srcUsername TEXT,  playbackRate DOUBLE,  songMId TEXT,  mid TEXT);

-- 字段说明:
--   musicId                        TEXT            -- 自增ID (主键)
--   originMusicId                  TEXT            -- 自增ID
--   musicType                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   downloadedLength               LONG            -- 长度/大小
--   wifiDownloadedLength           LONG            -- 长度/大小
--   endFlag                        INTEGER         -- 标记
--   wifiEndFlag                    INTEGER         -- 标记
--   updateTime                     LONG            -- 更新时间
--   songId                         INTEGER         -- 自增ID
--   songName                       TEXT           
--   songSinger                     TEXT           
--   songAlbum                      TEXT           
--   songAlbumType                  INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   songAlbumUrl                   TEXT           
--   songHAlbumUrl                  TEXT           
--   songAlbumLocalPath             TEXT           
--   songWifiUrl                    TEXT           
--   songWapLinkUrl                 TEXT           
--   songWebUrl                     TEXT           
--   appId                          TEXT            -- 开放IM应用ID
--   songMediaId                    TEXT            -- 自增ID
--   songSnsAlbumUser               TEXT           
--   songSnsShareUser               TEXT           
--   songLyric                      TEXT           
--   songBgColor                    INTEGER        
--   songLyricColor                 INTEGER        
--   songFileLength                 LONG            -- 长度/大小
--   songWifiFileLength             LONG            -- 长度/大小
--   hideBanner                     INTEGER         -- 自增ID
--   jsWebUrlDomain                 TEXT           
--   isBlock                        INTEGER        
--   startTime                      INTEGER         -- 开始时间
--   mimetype                       TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   protocol                       TEXT           
--   barBackToWebView               INTEGER        
--   musicbar_url                   TEXT           
--   srcUsername                    TEXT            -- 用户名
--   playbackRate                   DOUBLE         
--   songMId                        TEXT            -- 自增ID
--   mid                            TEXT            -- 中图路径


-- ========================================================
-- 表名: NewTipsInfo
-- ========================================================
-- 记录数: 2

CREATE TABLE NewTipsInfo (  tipId INTEGER default '0'  PRIMARY KEY ,  tipVersion INTEGER,  tipkey TEXT,  tipType INTEGER,  isExit INTEGER,  hadRead INTEGER,  isReject INTEGER,  beginShowTime LONG,  disappearTime LONG,  overdueTime LONG,  tipsShowInfo BLOB,  extInfo TEXT,  pagestaytime LONG);

-- 字段说明:
--   tipId                          INTEGER         -- 自增ID (主键)
--   tipVersion                     INTEGER        
--   tipkey                         TEXT           
--   tipType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   isExit                         INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   hadRead                        INTEGER        
--   isReject                       INTEGER        
--   beginShowTime                  LONG           
--   disappearTime                  LONG           
--   overdueTime                    LONG           
--   tipsShowInfo                   BLOB           
--   extInfo                        TEXT            -- 来源扩展信息
--   pagestaytime                   LONG           


-- ========================================================
-- 表名: NewTipsInfo2
-- ========================================================
-- 记录数: 5

CREATE TABLE NewTipsInfo2 (  uniqueId TEXT,  path INTEGER,  showType INTEGER,  title TEXT,  icon_url TEXT,  parents BLOB,  tipId INTEGER,  priority INTEGER,  tipType INTEGER,  beginShowTime LONG,  exposureTime LONG,  overdueTime LONG,  disappearTime LONG,  exposureDisappearTime LONG,  minClientVersion INTEGER,  maxClientVersion INTEGER,  extInfo TEXT,  state INTEGER default '0' ,  dynamicPath TEXT,  lang TEXT, regCountry TEXT);

-- 字段说明:
--   uniqueId                       TEXT            -- 自增ID
--   path                           INTEGER         -- 图片路径
--   showType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   title                          TEXT           
--   icon_url                       TEXT           
--   parents                        BLOB           
--   tipId                          INTEGER         -- 自增ID
--   priority                       INTEGER        
--   tipType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   beginShowTime                  LONG           
--   exposureTime                   LONG           
--   overdueTime                    LONG           
--   disappearTime                  LONG           
--   exposureDisappearTime          LONG           
--   minClientVersion               INTEGER        
--   maxClientVersion               INTEGER        
--   extInfo                        TEXT            -- 来源扩展信息
--   state                          INTEGER        
--   dynamicPath                    TEXT           
--   lang                           TEXT           
--   regCountry                     TEXT            -- 国家


-- ========================================================
-- 表名: NotifyMessageRecord
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 3,355

CREATE TABLE NotifyMessageRecord (  msgId LONG PRIMARY KEY ,  talker TEXT,  createTime LONG,  digest TEXT, is_special_talker INTEGER);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   createTime                     LONG            -- 创建时间
--   digest                         TEXT           
--   is_special_talker              INTEGER         -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: OfflineOrderStatus
-- ========================================================
-- 记录数: 12

CREATE TABLE OfflineOrderStatus (  reqkey TEXT PRIMARY KEY ,  ack_key TEXT,  status INTEGER,  receive_time LONG);

-- 字段说明:
--   reqkey                         TEXT            (主键)
--   ack_key                        TEXT           
--   status                         INTEGER         -- 消息状态
--   receive_time                   LONG           


-- ========================================================
-- 表名: OldAccountFriend
-- ========================================================
-- 记录数: 0

CREATE TABLE OldAccountFriend (  encryptUsername TEXT,  oldUsername TEXT,  ticket TEXT,  nickname TEXT,  addState INTEGER,  showHead INTEGER,  pinyinName TEXT,  username TEXT,  seq INTEGER);

-- 字段说明:
--   encryptUsername                TEXT            -- 加密用户名
--   oldUsername                    TEXT            -- 用户名
--   ticket                         TEXT            -- 票据
--   nickname                       TEXT            -- 昵称
--   addState                       INTEGER        
--   showHead                       INTEGER        
--   pinyinName                     TEXT           
--   username                       TEXT            -- 用户名
--   seq                            INTEGER         -- 消息序列号


-- ========================================================
-- 表名: OpenIMAccTypeInfo
-- ========================================================
-- 记录数: 6

CREATE TABLE OpenIMAccTypeInfo (  acctTypeId TEXT,  language TEXT,  accTypeRec BLOB,  updateTime LONG default '0' );

-- 字段说明:
--   acctTypeId                     TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   language                       TEXT           
--   accTypeRec                     BLOB            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: OpenIMAppIdInfo
-- ========================================================
-- 记录数: 10

CREATE TABLE OpenIMAppIdInfo (  appid TEXT,  language TEXT,  appRec BLOB,  updateTime LONG default '0' ,  acctTypeId TEXT,  subType INTEGER default '0' );

-- 字段说明:
--   appid                          TEXT            -- 开放IM应用ID
--   language                       TEXT           
--   appRec                         BLOB           
--   updateTime                     LONG            -- 更新时间
--   acctTypeId                     TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   subType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: OpenIMArchive
-- ========================================================
-- 记录数: 0

CREATE TABLE OpenIMArchive (  username TEXT PRIMARY KEY ,  content TEXT);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   content                        TEXT            -- 消息内容


-- ========================================================
-- 表名: OpenIMFinderInfoNew
-- ========================================================
-- 记录数: 112

CREATE TABLE OpenIMFinderInfoNew (  openIMUsername TEXT PRIMARY KEY ,  finder_username TEXT);

-- 字段说明:
--   openIMUsername                 TEXT            -- 用户名 (主键)
--   finder_username                TEXT            -- 用户名


-- ========================================================
-- 表名: OpenIMKefuContact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 14

CREATE TABLE OpenIMKefuContact (  username TEXT default ''  PRIMARY KEY ,  nickname TEXT default '' ,  bigHeadImg TEXT default '' ,  smallHeadImg TEXT default '' ,  nicknamePyInit TEXT default '' ,  nicknamePyQuanPin TEXT default '' ,  openImAppId TEXT default '' ,  openImDescWordingId TEXT default '' ,  source INTEGER default '' ,  checkTime INTEGER default '0' ,  customInfoDetailVisible INTEGER,  customInfoDetail TEXT,  ticket TEXT,  type LONG default '0' ,  finderUsername TEXT default '' ,  kfUrl TEXT default '' , hasSetReport INTEGER default 'false', locationType TEXT default 'Wsg84', needReport INTEGER default 'false', kefuType INTEGER default '0', kefuToolsInfo TEXT default '', enterprise_auth_status INTEGER default '0');

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   nickname                       TEXT            -- 昵称
--   bigHeadImg                     TEXT            -- 大头像URL
--   smallHeadImg                   TEXT            -- 小头像URL
--   nicknamePyInit                 TEXT            -- 昵称
--   nicknamePyQuanPin              TEXT            -- 昵称
--   openImAppId                    TEXT            -- 开放IM应用ID
--   openImDescWordingId            TEXT            -- 描述文字ID
--   source                         INTEGER         -- 来源扩展信息
--   checkTime                      INTEGER        
--   customInfoDetailVisible        INTEGER        
--   customInfoDetail               TEXT           
--   ticket                         TEXT            -- 票据
--   type                           LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   finderUsername                 TEXT            -- 用户名
--   kfUrl                          TEXT           
--   hasSetReport                   INTEGER        
--   locationType                   TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   needReport                     INTEGER        
--   kefuType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   kefuToolsInfo                  TEXT           
--   enterprise_auth_status         INTEGER         -- 消息状态


-- ========================================================
-- 表名: OpenIMSnsFlag
-- 说明: 朋友圈相关表
-- ========================================================
-- 记录数: 98

CREATE TABLE OpenIMSnsFlag (  openIMUsername TEXT PRIMARY KEY ,  openIMSnsFlag LONG default '0' );

-- 字段说明:
--   openIMUsername                 TEXT            -- 用户名 (主键)
--   openIMSnsFlag                  LONG            -- 标记


-- ========================================================
-- 表名: OpenIMWordingInfo
-- ========================================================
-- 记录数: 203

CREATE TABLE OpenIMWordingInfo (  appid TEXT,  wordingId TEXT,  language TEXT,  wording TEXT,  pinyin TEXT,  quanpin TEXT,  updateTime LONG default '0' );

-- 字段说明:
--   appid                          TEXT            -- 开放IM应用ID
--   wordingId                      TEXT            -- 描述文字ID
--   language                       TEXT           
--   wording                        TEXT            -- 品牌翻译
--   pinyin                         TEXT           
--   quanpin                        TEXT            -- 全拼
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: OpenMsgListener
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE OpenMsgListener (  appId TEXT PRIMARY KEY ,  packageName TEXT,  status INTEGER default '0' ,  sceneFlag INTEGER default '0' ,  msgTypeFlag INTEGER default '0' ,  msgState INTEGER default '0' );

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID (主键)
--   packageName                    TEXT           
--   status                         INTEGER         -- 消息状态
--   sceneFlag                      INTEGER         -- 标记
--   msgTypeFlag                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   msgState                       INTEGER        


-- ========================================================
-- 表名: OrderCommonMsgXml
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE OrderCommonMsgXml (  msgId TEXT PRIMARY KEY ,  msgContentXml TEXT,  isRead TEXT);

-- 字段说明:
--   msgId                          TEXT            -- 消息ID (本地) (主键)
--   msgContentXml                  TEXT            -- 消息内容
--   isRead                         TEXT           


-- ========================================================
-- 表名: PBCache
-- ========================================================
-- 记录数: 1

CREATE TABLE PBCache (  key TEXT PRIMARY KEY ,  value BLOB);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   value                          BLOB           


-- ========================================================
-- 表名: PendingCardId
-- ========================================================
-- 记录数: 0

CREATE TABLE PendingCardId (  cardUserId TEXT PRIMARY KEY ,  retryCount INTEGER);

-- 字段说明:
--   cardUserId                     TEXT            -- 自增ID (主键)
--   retryCount                     INTEGER        


-- ========================================================
-- 表名: PieceMusicInfo
-- ========================================================
-- 记录数: 5

CREATE TABLE PieceMusicInfo (  musicId TEXT PRIMARY KEY ,  musicUrl TEXT,  fileName TEXT,  indexBitData BLOB,  fileCacheComplete INTEGER,  pieceFileMIMEType TEXT,  removeDirtyBit INTEGER);

-- 字段说明:
--   musicId                        TEXT            -- 自增ID (主键)
--   musicUrl                       TEXT           
--   fileName                       TEXT           
--   indexBitData                   BLOB            -- 数据
--   fileCacheComplete              INTEGER        
--   pieceFileMIMEType              TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   removeDirtyBit                 INTEGER        


-- ========================================================
-- 表名: PocketMoneyMsgRecord
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE PocketMoneyMsgRecord (  payMsgId TEXT PRIMARY KEY ,  msgId LONG);

-- 字段说明:
--   payMsgId                       TEXT            -- 消息ID (本地) (主键)
--   msgId                          LONG            -- 消息ID (本地)


-- ========================================================
-- 表名: ProfileInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ProfileInfo (  username TEXT PRIMARY KEY ,  originalArticleCount INTEGER default '1' ,  friendSubscribeCount INTEGER default '1' ,  allArticleWording TEXT,  historyArticlesUrl TEXT,  userRole INTEGER default '1' ,  banReason TEXT,  showRecommendArticle INTEGER default '0' ,  showService INTEGER default '0' ,  messageListStr TEXT,  serviceInfoListStr TEXT,  bizAccountListStr TEXT,  cacheTime LONG default '0' ,  decryptUserName TEXT default '' ,  hiddenAvatar INTEGER default '0' ,  hiddenButtonBeforeFocus INTEGER default '0' ,  newBanReason TEXT);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   originalArticleCount           INTEGER        
--   friendSubscribeCount           INTEGER        
--   allArticleWording              TEXT           
--   historyArticlesUrl             TEXT           
--   userRole                       INTEGER        
--   banReason                      TEXT           
--   showRecommendArticle           INTEGER        
--   showService                    INTEGER        
--   messageListStr                 TEXT           
--   serviceInfoListStr             TEXT           
--   bizAccountListStr              TEXT           
--   cacheTime                      LONG           
--   decryptUserName                TEXT            -- 用户名
--   hiddenAvatar                   INTEGER         -- 自增ID
--   hiddenButtonBeforeFocus        INTEGER         -- 自增ID
--   newBanReason                   TEXT           


-- ========================================================
-- 表名: RecordCDNInfo
-- ========================================================
-- 记录数: 3

CREATE TABLE RecordCDNInfo (  localId INTEGER PRIMARY KEY ,  recordLocalId INTEGER,  toUser TEXT default '' ,  dataId TEXT,  mediaId TEXT,  path TEXT,  cdnUrl TEXT,  cdnKey TEXT,  totalLen INTEGER default '0' ,  isThumb INTEGER default 'false' ,  offset INTEGER default '0' ,  type INTEGER default '0' ,  fileType INTEGER default '5' ,  status INTEGER default '0' ,  errCode INTEGER default '0' ,  tpaeskey TEXT,  tpauthkey TEXT,  tpdataurl TEXT);

-- 字段说明:
--   localId                        INTEGER         -- 消息本地ID (主键)
--   recordLocalId                  INTEGER         -- 自增ID
--   toUser                         TEXT           
--   dataId                         TEXT            -- 自增ID
--   mediaId                        TEXT            -- 自增ID
--   path                           TEXT            -- 图片路径
--   cdnUrl                         TEXT           
--   cdnKey                         TEXT           
--   totalLen                       INTEGER        
--   isThumb                        INTEGER        
--   offset                         INTEGER        
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   fileType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   errCode                        INTEGER        
--   tpaeskey                       TEXT            -- AES密钥
--   tpauthkey                      TEXT           
--   tpdataurl                      TEXT            -- 数据


-- ========================================================
-- 表名: RecordMessageInfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE RecordMessageInfo (  localId INTEGER PRIMARY KEY ,  msgId LONG default '-1' ,  oriMsgId LONG default '-1' ,  toUser TEXT default '' ,  title TEXT,  desc TEXT,  dataProto BLOB,  type INTEGER default '0' ,  status INTEGER default '0' ,  favFrom TEXT, oriMsgTalker TEXT default '');

-- 字段说明:
--   localId                        INTEGER         -- 消息本地ID (主键)
--   msgId                          LONG            -- 消息ID (本地)
--   oriMsgId                       LONG            -- 消息ID (本地)
--   toUser                         TEXT           
--   title                          TEXT           
--   desc                           TEXT            -- 描述文字ID
--   dataProto                      BLOB            -- 数据
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   favFrom                        TEXT           
--   oriMsgTalker                   TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: RemittanceRecord
-- ========================================================
-- 记录数: 503

CREATE TABLE RemittanceRecord (  transferId TEXT PRIMARY KEY ,  locaMsgId LONG,  receiveStatus INTEGER default '-1' ,  isSend INTEGER,  talker TEXT,  invalidtime LONG,  receiverName TEXT,  hasClicked INTEGER, receiveTime LONG);

-- 字段说明:
--   transferId                     TEXT            -- 转账ID (主键)
--   locaMsgId                      LONG            -- 消息ID (本地)
--   receiveStatus                  INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   invalidtime                    LONG            -- 失效时间
--   receiverName                   TEXT            -- 收款人
--   hasClicked                     INTEGER        
--   receiveTime                    LONG           


-- ========================================================
-- 表名: RoomVerifyApplicationStg
-- ========================================================
-- 记录数: 31

CREATE TABLE RoomVerifyApplicationStg (  primaryKey TEXT PRIMARY KEY ,  hashKey TEXT,  chatRoomName TEXT,  msgId LONG,  data BLOB,  state INTEGER,  read INTEGER,  updateTime LONG);

-- 字段说明:
--   primaryKey                     TEXT            (主键)
--   hashKey                        TEXT           
--   chatRoomName                   TEXT            -- 群聊名称
--   msgId                          LONG            -- 消息ID (本地)
--   data                           BLOB            -- 数据
--   state                          INTEGER        
--   read                           INTEGER        
--   updateTime                     LONG            -- 更新时间


-- ========================================================
-- 表名: RtosQuickReplyInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE RtosQuickReplyInfo (  orderIndex INTEGER,  quickMsg TEXT);

-- 字段说明:
--   orderIndex                     INTEGER        
--   quickMsg                       TEXT           


-- ========================================================
-- 表名: SafeDeviceInfo
-- ========================================================
-- 记录数: 10

CREATE TABLE SafeDeviceInfo (  uid TEXT default ''  PRIMARY KEY ,  name TEXT default '' ,  devicetype TEXT default '' ,  createtime LONG default '0' , online INTEGER default 'false');

-- 字段说明:
--   uid                            TEXT            -- 自增ID (主键)
--   name                           TEXT            -- 用户名
--   devicetype                     TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createtime                     LONG            -- 创建时间
--   online                         INTEGER        


-- ========================================================
-- 表名: ScanHistoryItem
-- ========================================================
-- 记录数: 0

CREATE TABLE ScanHistoryItem (  productId TEXT PRIMARY KEY ,  xmlContent TEXT,  ScanTime LONG,  funcType INTEGER,  qrcodeUrl TEXT,  scene INTEGER);

-- 字段说明:
--   productId                      TEXT            -- 自增ID (主键)
--   xmlContent                     TEXT            -- 消息内容
--   ScanTime                       LONG           
--   funcType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   qrcodeUrl                      TEXT           
--   scene                          INTEGER        


-- ========================================================
-- 表名: ScanTranslationResult
-- ========================================================
-- 记录数: 4

CREATE TABLE ScanTranslationResult (  originMD5 TEXT PRIMARY KEY ,  resultFile TEXT,  fromLang TEXT,  toLang TEXT,  brand TEXT, resultImageAesKey TEXT, originalImageAesKey TEXT, originalImageFileId TEXT, resultImageFileId TEXT);

-- 字段说明:
--   originMD5                      TEXT            -- MD5值 (主键)
--   resultFile                     TEXT           
--   fromLang                       TEXT           
--   toLang                         TEXT           
--   brand                          TEXT            -- 品牌翻译
--   resultImageAesKey              TEXT            -- AES密钥
--   originalImageAesKey            TEXT            -- AES密钥
--   originalImageFileId            TEXT            -- 自增ID
--   resultImageFileId              TEXT            -- 自增ID


-- ========================================================
-- 表名: SelectRecord
-- ========================================================
-- 记录数: 0

CREATE TABLE SelectRecord (  historyId TEXT,  msgId LONG,  talker TEXT,  chatHistoryItem BLOB);

-- 字段说明:
--   historyId                      TEXT            -- 历史ID
--   msgId                          LONG            -- 消息ID (本地)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   chatHistoryItem                BLOB           


-- ========================================================
-- 表名: ShakeNewYearFriendInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ShakeNewYearFriendInfo (  username TEXT default ''  PRIMARY KEY ,  lastshaketime INTEGER default '0' ,  isshowed INTEGER default 'false' );

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   lastshaketime                  INTEGER        
--   isshowed                       INTEGER        


-- ========================================================
-- 表名: ShareCardInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ShareCardInfo (  card_id TEXT PRIMARY KEY ,  card_tp_id TEXT,  from_username TEXT,  consumer TEXT,  app_id TEXT,  status INTEGER,  share_time LONG,  local_updateTime LONG,  updateTime LONG,  begin_time LONG,  end_time LONG,  updateSeq LONG,  block_mask LONG,  dataInfoData BLOB,  cardTpInfoData BLOB,  shareInfoData BLOB,  shopInfoData BLOB,  categoryType INTEGER default '0' ,  itemIndex INTEGER default '0' );

-- 字段说明:
--   card_id                        TEXT            -- 自增ID (主键)
--   card_tp_id                     TEXT            -- 自增ID
--   from_username                  TEXT            -- 用户名
--   consumer                       TEXT           
--   app_id                         TEXT            -- 自增ID
--   status                         INTEGER         -- 消息状态
--   share_time                     LONG           
--   local_updateTime               LONG            -- 更新时间
--   updateTime                     LONG            -- 更新时间
--   begin_time                     LONG           
--   end_time                       LONG           
--   updateSeq                      LONG            -- 更新序列
--   block_mask                     LONG           
--   dataInfoData                   BLOB            -- 数据
--   cardTpInfoData                 BLOB            -- 数据
--   shareInfoData                  BLOB            -- 数据
--   shopInfoData                   BLOB            -- 数据
--   categoryType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   itemIndex                      INTEGER        


-- ========================================================
-- 表名: ShareCardSyncItemInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE ShareCardSyncItemInfo (  card_id TEXT PRIMARY KEY ,  state_flag INTEGER,  update_time LONG,  seq LONG,  retryCount INTEGER);

-- 字段说明:
--   card_id                        TEXT            -- 自增ID (主键)
--   state_flag                     INTEGER         -- 标记
--   update_time                    LONG           
--   seq                            LONG            -- 消息序列号
--   retryCount                     INTEGER        


-- ========================================================
-- 表名: SightDraftInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE SightDraftInfo (  localId INTEGER PRIMARY KEY ,  fileName TEXT,  fileNameHash INTEGER,  fileMd5 TEXT default '' ,  fileLength LONG default '0' ,  fileStatus INTEGER default '0' ,  fileDuration INTEGER default '0' ,  createTime LONG default '0' );

-- 字段说明:
--   localId                        INTEGER         -- 消息本地ID (主键)
--   fileName                       TEXT           
--   fileNameHash                   INTEGER        
--   fileMd5                        TEXT            -- MD5值
--   fileLength                     LONG            -- 长度/大小
--   fileStatus                     INTEGER         -- 消息状态
--   fileDuration                   INTEGER        
--   createTime                     LONG            -- 创建时间


-- ========================================================
-- 表名: SignedAgreementInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE SignedAgreementInfo (  key TEXT PRIMARY KEY ,  selfUsername TEXT,  id INTEGER,  signedVersion INTEGER default '0' );

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   selfUsername                   TEXT            -- 用户名
--   id                             INTEGER         -- 自增ID
--   signedVersion                  INTEGER        


-- ========================================================
-- 表名: SmileyInfo
-- ========================================================
-- 记录数: 45

CREATE TABLE SmileyInfo (  key TEXT PRIMARY KEY ,  cnValue TEXT,  qqValue TEXT,  twValue TEXT,  enValue TEXT,  thValue TEXT,  fileName TEXT,  eggIndex INTEGER default '-1' ,  position INTEGER default '-1' ,  flag INTEGER);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   cnValue                        TEXT           
--   qqValue                        TEXT           
--   twValue                        TEXT           
--   enValue                        TEXT           
--   thValue                        TEXT           
--   fileName                       TEXT           
--   eggIndex                       INTEGER        
--   position                       INTEGER        
--   flag                           INTEGER         -- 标记


-- ========================================================
-- 表名: SmileyPanelConfigInfo
-- ========================================================
-- 记录数: 109

CREATE TABLE SmileyPanelConfigInfo (  key TEXT PRIMARY KEY ,  position INTEGER);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   position                       INTEGER        


-- ========================================================
-- 表名: Stranger
-- ========================================================
-- 记录数: 4

CREATE TABLE Stranger (  encryptUsername TEXT default ''  PRIMARY KEY ,  conRemark TEXT default '' ,  contactLabels TEXT default '' ,  conDescription TEXT default '' ,  conPhone TEXT default '' );

-- 字段说明:
--   encryptUsername                TEXT            -- 加密用户名 (主键)
--   conRemark                      TEXT            -- 备注名
--   contactLabels                  TEXT           
--   conDescription                 TEXT           
--   conPhone                       TEXT           


-- ========================================================
-- 表名: TablesVersion
-- 说明: AB测试相关表
-- ========================================================
-- 记录数: 465

CREATE TABLE TablesVersion (  tableHash INTEGER PRIMARY KEY ,  tableSQLMD5 TEXT);

-- 字段说明:
--   tableHash                      INTEGER         (主键)
--   tableSQLMD5                    TEXT            -- MD5值


-- ========================================================
-- 表名: TaskBarInfo
-- ========================================================
-- 记录数: 1,441

CREATE TABLE TaskBarInfo (  id TEXT PRIMARY KEY ,  type INTEGER default '0' ,  createTime LONG default '0' ,  updateTime LONG default '0' ,  showData BLOB,  data BLOB default '' );

-- 字段说明:
--   id                             TEXT            -- 自增ID (主键)
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createTime                     LONG            -- 创建时间
--   updateTime                     LONG            -- 更新时间
--   showData                       BLOB            -- 数据
--   data                           BLOB            -- 数据


-- ========================================================
-- 表名: TopMsgInfoRecord
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 17

CREATE TABLE TopMsgInfoRecord (  chatRoomName TEXT,  id INTEGER,  isCancel INTEGER default 'false' ,  topMsgInfoItem BLOB);

-- 字段说明:
--   chatRoomName                   TEXT            -- 群聊名称
--   id                             INTEGER         -- 自增ID
--   isCancel                       INTEGER        
--   topMsgInfoItem                 BLOB           


-- ========================================================
-- 表名: UDRResource
-- ========================================================
-- 记录数: 94

CREATE TABLE UDRResource (  key TEXT PRIMARY KEY ,  projectId TEXT,  name TEXT,  version INTEGER,  url TEXT,  md5 TEXT,  size LONG,  path TEXT,  postPath TEXT,  category INTEGER,  type INTEGER,  createTime LONG,  updateTime LONG,  extId LONG,  signatureKey TEXT,  fileKey TEXT, extInfo BLOB, expireTime LONG, specifiedExtInfo TEXT, virtualPath TEXT, encryptFileSize LONG, encryptIv BLOB, encryptAad BLOB, encryptMd5 TEXT, encryptAlgo INTEGER, encryptTag BLOB, uinMd5 TEXT, encryptKey BLOB, storageType INTEGER);

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   projectId                      TEXT            -- 自增ID
--   name                           TEXT            -- 用户名
--   version                        INTEGER         -- 群信息版本
--   url                            TEXT            -- CDN大图URL
--   md5                            TEXT            -- MD5值
--   size                           LONG           
--   path                           TEXT            -- 图片路径
--   postPath                       TEXT           
--   category                       INTEGER        
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createTime                     LONG            -- 创建时间
--   updateTime                     LONG            -- 更新时间
--   extId                          LONG            -- 自增ID
--   signatureKey                   TEXT            -- 个性签名
--   fileKey                        TEXT           
--   extInfo                        BLOB            -- 来源扩展信息
--   expireTime                     LONG            -- 过期时间
--   specifiedExtInfo               TEXT            -- 扩展
--   virtualPath                    TEXT           
--   encryptFileSize                LONG           
--   encryptIv                      BLOB           
--   encryptAad                     BLOB           
--   encryptMd5                     TEXT            -- MD5值
--   encryptAlgo                    INTEGER        
--   encryptTag                     BLOB           
--   uinMd5                         TEXT            -- MD5值
--   encryptKey                     BLOB           
--   storageType                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: UserCardInfo
-- ========================================================
-- 记录数: 14

CREATE TABLE UserCardInfo (  card_id TEXT PRIMARY KEY ,  card_tp_id TEXT,  from_username TEXT,  status INTEGER,  delete_state_flag INTEGER,  local_updateTime LONG,  updateTime LONG,  updateSeq LONG,  create_time LONG,  begin_time LONG,  end_time LONG,  block_mask TEXT,  dataInfoData BLOB,  cardTpInfoData BLOB,  shareInfoData BLOB,  shopInfoData BLOB,  stickyIndex INTEGER,  stickyEndTime INTEGER,  stickyAnnouncement TEXT,  card_type INTEGER default '-1' ,  label_wording TEXT,  is_dynamic INTEGER);

-- 字段说明:
--   card_id                        TEXT            -- 自增ID (主键)
--   card_tp_id                     TEXT            -- 自增ID
--   from_username                  TEXT            -- 用户名
--   status                         INTEGER         -- 消息状态
--   delete_state_flag              INTEGER         -- 标记
--   local_updateTime               LONG            -- 更新时间
--   updateTime                     LONG            -- 更新时间
--   updateSeq                      LONG            -- 更新序列
--   create_time                    LONG           
--   begin_time                     LONG           
--   end_time                       LONG           
--   block_mask                     TEXT           
--   dataInfoData                   BLOB            -- 数据
--   cardTpInfoData                 BLOB            -- 数据
--   shareInfoData                  BLOB            -- 数据
--   shopInfoData                   BLOB            -- 数据
--   stickyIndex                    INTEGER        
--   stickyEndTime                  INTEGER         -- 结束时间
--   stickyAnnouncement             TEXT           
--   card_type                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   label_wording                  TEXT           
--   is_dynamic                     INTEGER        


-- ========================================================
-- 表名: UserOpenIdInApp
-- ========================================================
-- 记录数: 0

CREATE TABLE UserOpenIdInApp (  openId TEXT PRIMARY KEY ,  appId TEXT,  username TEXT);

-- 字段说明:
--   openId                         TEXT            -- 自增ID (主键)
--   appId                          TEXT            -- 开放IM应用ID
--   username                       TEXT            -- 用户名


-- ========================================================
-- 表名: VideoEditInfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE VideoEditInfo (  taskId TEXT PRIMARY KEY ,  baseItemData BLOB,  timeStamp LONG,  mixRetryTime INTEGER,  expiredTime LONG,  status INTEGER,  targetWidth INTEGER,  targetHeight INTEGER,  videoBitrate INTEGER,  audioBitrate INTEGER,  audioSampleRate INTEGER,  audioChannelCount INTEGER,  frameRate INTEGER,  videoRotate INTEGER,  extraConfig BLOB,  reportInfo TEXT,  userData TEXT,  location BLOB,  mixFlag INTEGER,  blurBgPath TEXT,  fromScene INTEGER);

-- 字段说明:
--   taskId                         TEXT            -- 自增ID (主键)
--   baseItemData                   BLOB            -- 数据
--   timeStamp                      LONG           
--   mixRetryTime                   INTEGER        
--   expiredTime                    LONG           
--   status                         INTEGER         -- 消息状态
--   targetWidth                    INTEGER         -- 自增ID
--   targetHeight                   INTEGER        
--   videoBitrate                   INTEGER         -- 自增ID
--   audioBitrate                   INTEGER        
--   audioSampleRate                INTEGER        
--   audioChannelCount              INTEGER        
--   frameRate                      INTEGER        
--   videoRotate                    INTEGER         -- 自增ID
--   extraConfig                    BLOB            -- 额外数据
--   reportInfo                     TEXT           
--   userData                       TEXT            -- 数据
--   location                       BLOB           
--   mixFlag                        INTEGER         -- 标记
--   blurBgPath                     TEXT           
--   fromScene                      INTEGER        


-- ========================================================
-- 表名: VideoHash
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 39

CREATE TABLE VideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: VideoPlayHistory
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 2,039

CREATE TABLE VideoPlayHistory ( filename text PRIMARY KEY, starttime int, playduration int, downloadway int );

-- 字段说明:
--   filename                       text            (主键)
--   starttime                      int             -- 开始时间
--   playduration                   int            
--   downloadway                    int            


-- ========================================================
-- 表名: VoiceTransText
-- 说明: 语音转文字表
-- ========================================================
-- 记录数: 931

CREATE TABLE VoiceTransText (  msgId LONG PRIMARY KEY ,  cmsgId TEXT,  content TEXT default '' );

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   cmsgId                         TEXT            -- 消息ID (本地)
--   content                        TEXT            -- 消息内容


-- ========================================================
-- 表名: WalletBankcard
-- 说明: 钱包银行卡表
-- ========================================================
-- 记录数: 8

CREATE TABLE WalletBankcard (  bindSerial TEXT PRIMARY KEY ,  defaultCardState INTEGER,  cardType INTEGER,  bankcardState INTEGER,  forbidWord TEXT,  bankName TEXT,  bankcardType TEXT,  bankcardTypeName TEXT,  bankcardTag INTEGER,  bankcardTail TEXT,  supportTag INTEGER,  mobile TEXT,  trueName TEXT,  desc TEXT,  bankPhone TEXT,  bizUsername TEXT,  onceQuotaKind DOUBLE,  onceQuotaVirtual DOUBLE,  dayQuotaKind DOUBLE,  dayQuotaVirtual DOUBLE,  fetchArriveTime LONG,  fetchArriveTimeWording TEXT,  repay_url TEXT,  wxcreditState INTEGER,  bankcardClientType INTEGER,  ext_msg TEXT,  support_micropay INTEGER,  arrive_type TEXT,  avail_save_wording TEXT,  fetch_charge_rate DOUBLE,  full_fetch_charge_fee DOUBLE,  fetch_charge_info TEXT,  tips TEXT,  forbid_title TEXT,  forbid_url TEXT,  no_micro_word TEXT,  card_bottom_wording TEXT,  support_lqt_turn_in INTEGER,  support_lqt_turn_out INTEGER,  is_hightlight_pre_arrive_time_wording INTEGER,  card_state_name TEXT,  prompt_info_prompt_text TEXT,  prompt_info_jump_text TEXT,  prompt_info_jump_url TEXT,  yht_related_bank TEXT,  yht_avail_balance LONG,  yht_user_state INTEGER,  yht_system_state INTEGER,  yht_ext_msg TEXT,  minimch_key TEXT,  minimch_avail_balance LONG,  minimch_user_state INTEGER,  minimch_system_state INTEGER,  minimch_ext_msg TEXT);

-- 字段说明:
--   bindSerial                     TEXT            (主键)
--   defaultCardState               INTEGER        
--   cardType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardState                  INTEGER        
--   forbidWord                     TEXT            -- 自增ID
--   bankName                       TEXT           
--   bankcardType                   TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardTypeName               TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardTag                    INTEGER        
--   bankcardTail                   TEXT           
--   supportTag                     INTEGER        
--   mobile                         TEXT           
--   trueName                       TEXT           
--   desc                           TEXT            -- 描述文字ID
--   bankPhone                      TEXT           
--   bizUsername                    TEXT            -- 用户名
--   onceQuotaKind                  DOUBLE         
--   onceQuotaVirtual               DOUBLE         
--   dayQuotaKind                   DOUBLE         
--   dayQuotaVirtual                DOUBLE         
--   fetchArriveTime                LONG           
--   fetchArriveTimeWording         TEXT           
--   repay_url                      TEXT           
--   wxcreditState                  INTEGER        
--   bankcardClientType             INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   ext_msg                        TEXT            -- 扩展
--   support_micropay               INTEGER        
--   arrive_type                    TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   avail_save_wording             TEXT           
--   fetch_charge_rate              DOUBLE         
--   full_fetch_charge_fee          DOUBLE          -- 金额
--   fetch_charge_info              TEXT           
--   tips                           TEXT           
--   forbid_title                   TEXT            -- 自增ID
--   forbid_url                     TEXT            -- 自增ID
--   no_micro_word                  TEXT           
--   card_bottom_wording            TEXT           
--   support_lqt_turn_in            INTEGER        
--   support_lqt_turn_out           INTEGER        
--   is_hightlight_pre_arrive_time_wording INTEGER        
--   card_state_name                TEXT           
--   prompt_info_prompt_text        TEXT            -- 扩展
--   prompt_info_jump_text          TEXT            -- 扩展
--   prompt_info_jump_url           TEXT           
--   yht_related_bank               TEXT           
--   yht_avail_balance              LONG           
--   yht_user_state                 INTEGER        
--   yht_system_state               INTEGER        
--   yht_ext_msg                    TEXT            -- 扩展
--   minimch_key                    TEXT           
--   minimch_avail_balance          LONG           
--   minimch_user_state             INTEGER        
--   minimch_system_state           INTEGER        
--   minimch_ext_msg                TEXT            -- 扩展


-- ========================================================
-- 表名: WalletBankcardScene
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 13

CREATE TABLE WalletBankcardScene (  fakePk INTEGER PRIMARY KEY ,  bindSerial TEXT,  defaultCardState INTEGER,  cardType INTEGER,  bankcardState INTEGER,  forbidWord TEXT,  bankName TEXT,  bankcardType TEXT,  bankcardTypeName TEXT,  bankcardTag INTEGER,  bankcardTail TEXT,  supportTag INTEGER,  mobile TEXT,  trueName TEXT,  desc TEXT,  bankPhone TEXT,  bizUsername TEXT,  onceQuotaKind DOUBLE,  onceQuotaVirtual DOUBLE,  dayQuotaKind DOUBLE,  dayQuotaVirtual DOUBLE,  fetchArriveTime LONG,  fetchArriveTimeWording TEXT,  repay_url TEXT,  wxcreditState INTEGER,  bankcardClientType INTEGER,  ext_msg TEXT,  support_micropay INTEGER,  arrive_type TEXT,  avail_save_wording TEXT,  fetch_charge_rate DOUBLE,  full_fetch_charge_fee DOUBLE,  fetch_charge_info TEXT,  tips TEXT,  forbid_title TEXT,  forbid_url TEXT,  no_micro_word TEXT,  card_bottom_wording TEXT,  support_lqt_turn_in INTEGER,  support_lqt_turn_out INTEGER,  is_hightlight_pre_arrive_time_wording INTEGER,  card_state_name TEXT,  prompt_info_prompt_text TEXT,  prompt_info_jump_text TEXT,  prompt_info_jump_url TEXT,  yht_related_bank TEXT,  yht_avail_balance LONG,  yht_user_state INTEGER,  yht_system_state INTEGER,  yht_ext_msg TEXT,  minimch_key TEXT,  minimch_avail_balance LONG,  minimch_user_state INTEGER,  minimch_system_state INTEGER,  minimch_ext_msg TEXT,  scene INTEGER default '0' );

-- 字段说明:
--   fakePk                         INTEGER         (主键)
--   bindSerial                     TEXT           
--   defaultCardState               INTEGER        
--   cardType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardState                  INTEGER        
--   forbidWord                     TEXT            -- 自增ID
--   bankName                       TEXT           
--   bankcardType                   TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardTypeName               TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   bankcardTag                    INTEGER        
--   bankcardTail                   TEXT           
--   supportTag                     INTEGER        
--   mobile                         TEXT           
--   trueName                       TEXT           
--   desc                           TEXT            -- 描述文字ID
--   bankPhone                      TEXT           
--   bizUsername                    TEXT            -- 用户名
--   onceQuotaKind                  DOUBLE         
--   onceQuotaVirtual               DOUBLE         
--   dayQuotaKind                   DOUBLE         
--   dayQuotaVirtual                DOUBLE         
--   fetchArriveTime                LONG           
--   fetchArriveTimeWording         TEXT           
--   repay_url                      TEXT           
--   wxcreditState                  INTEGER        
--   bankcardClientType             INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   ext_msg                        TEXT            -- 扩展
--   support_micropay               INTEGER        
--   arrive_type                    TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   avail_save_wording             TEXT           
--   fetch_charge_rate              DOUBLE         
--   full_fetch_charge_fee          DOUBLE          -- 金额
--   fetch_charge_info              TEXT           
--   tips                           TEXT           
--   forbid_title                   TEXT            -- 自增ID
--   forbid_url                     TEXT            -- 自增ID
--   no_micro_word                  TEXT           
--   card_bottom_wording            TEXT           
--   support_lqt_turn_in            INTEGER        
--   support_lqt_turn_out           INTEGER        
--   is_hightlight_pre_arrive_time_wording INTEGER        
--   card_state_name                TEXT           
--   prompt_info_prompt_text        TEXT            -- 扩展
--   prompt_info_jump_text          TEXT            -- 扩展
--   prompt_info_jump_url           TEXT           
--   yht_related_bank               TEXT           
--   yht_avail_balance              LONG           
--   yht_user_state                 INTEGER        
--   yht_system_state               INTEGER        
--   yht_ext_msg                    TEXT            -- 扩展
--   minimch_key                    TEXT           
--   minimch_avail_balance          LONG           
--   minimch_user_state             INTEGER        
--   minimch_system_state           INTEGER        
--   minimch_ext_msg                TEXT            -- 扩展
--   scene                          INTEGER        


-- ========================================================
-- 表名: WalletBulletin
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE WalletBulletin (  bulletin_scene TEXT PRIMARY KEY ,  bulletin_content TEXT,  bulletin_url TEXT,  is_show_notice INTEGER,  wording TEXT,  left_icon TEXT,  jump_url TEXT,  notice_id TEXT,  type INTEGER default '1' );

-- 字段说明:
--   bulletin_scene                 TEXT            (主键)
--   bulletin_content               TEXT            -- 消息内容
--   bulletin_url                   TEXT           
--   is_show_notice                 INTEGER        
--   wording                        TEXT            -- 品牌翻译
--   left_icon                      TEXT           
--   jump_url                       TEXT           
--   notice_id                      TEXT            -- 自增ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: WalletFunciontList
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE WalletFunciontList (  wallet_region INTEGER PRIMARY KEY ,  function_list TEXT,  new_list TEXT,  banner_list TEXT,  type_name_list TEXT,  isShowSetting INTEGER);

-- 字段说明:
--   wallet_region                  INTEGER         (主键)
--   function_list                  TEXT           
--   new_list                       TEXT           
--   banner_list                    TEXT           
--   type_name_list                 TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   isShowSetting                  INTEGER        


-- ========================================================
-- 表名: WalletKindInfo
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE WalletKindInfo (  wallet_tpa_country TEXT PRIMARY KEY ,  wallet_type INTEGER,  wallet_name TEXT,  wallet_selected INTEGER,  wallet_balance INTEGER,  wallet_tpa_country_mask INTEGER);

-- 字段说明:
--   wallet_tpa_country             TEXT            -- 国家 (主键)
--   wallet_type                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   wallet_name                    TEXT           
--   wallet_selected                INTEGER        
--   wallet_balance                 INTEGER        
--   wallet_tpa_country_mask        INTEGER         -- 国家


-- ========================================================
-- 表名: WalletLuckyMoney
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 6,170

CREATE TABLE WalletLuckyMoney (  mNativeUrl TEXT PRIMARY KEY ,  hbType INTEGER,  receiveAmount LONG,  receiveTime LONG,  receiveStatus INTEGER,  hbStatus INTEGER,  sender TEXT,  exclusiveUsername TEXT,  sendId TEXT,  invalidtime INTEGER,  msgSvrId LONG, msgLocalId LONG);

-- 字段说明:
--   mNativeUrl                     TEXT            (主键)
--   hbType                         INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   receiveAmount                  LONG           
--   receiveTime                    LONG           
--   receiveStatus                  INTEGER         -- 消息状态
--   hbStatus                       INTEGER         -- 消息状态
--   sender                         TEXT           
--   exclusiveUsername              TEXT            -- 用户名
--   sendId                         TEXT            -- 自增ID
--   invalidtime                    INTEGER         -- 失效时间
--   msgSvrId                       LONG            -- 消息服务器ID
--   msgLocalId                     LONG            -- 消息本地ID


-- ========================================================
-- 表名: WalletPrefInfo
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE WalletPrefInfo (  pref_key TEXT PRIMARY KEY ,  pref_title TEXT,  pref_url TEXT,  is_show INTEGER default '1' ,  pref_desc TEXT,  logo_url TEXT,  jump_type INTEGER,  tinyapp_username TEXT,  tinyapp_path TEXT);

-- 字段说明:
--   pref_key                       TEXT            (主键)
--   pref_title                     TEXT           
--   pref_url                       TEXT           
--   is_show                        INTEGER        
--   pref_desc                      TEXT           
--   logo_url                       TEXT           
--   jump_type                      INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   tinyapp_username               TEXT            -- 用户名
--   tinyapp_path                   TEXT           


-- ========================================================
-- 表名: WalletRegionGreyAreaList
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE WalletRegionGreyAreaList (  wallet_region INTEGER PRIMARY KEY ,  wallet_grey_item_buf BLOB);

-- 字段说明:
--   wallet_region                  INTEGER         (主键)
--   wallet_grey_item_buf           BLOB            -- 二进制Buffer


-- ========================================================
-- 表名: WalletUserInfo
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 1

CREATE TABLE WalletUserInfo (  uin TEXT PRIMARY KEY ,  is_reg INTEGER,  true_name TEXT,  card_num INTEGER,  isDomesticUser INTEGER,  cre_type INTEGER,  main_card_bind_serialno TEXT,  ftf_pay_url TEXT,  switchConfig INTEGER,  reset_passwd_flag TEXT,  find_passwd_url TEXT,  is_open_touch INTEGER,  lct_wording TEXT,  lct_url TEXT,  cre_name TEXT,  lqt_state INTEGER,  paymenu_use_new INTEGER,  is_show_lqb INTEGER,  is_open_lqb INTEGER,  lqb_open_url TEXT,  lqt_cell_is_show INTEGER,  lqt_cell_icon TEXT,  lqt_cell_is_open_lqt INTEGER,  lqt_cell_lqt_open_url TEXT,  lqt_cell_lqt_title TEXT,  lqt_cell_lqt_wording TEXT,  forget_passwd_url TEXT,  unipay_order_state INTEGER,  bank_priority TEXT,  wallet_balance LONG,  wallet_entrance_balance_switch_state INTEGER,  soter_pay_open_type INTEGER,  authen_account_type INTEGER default '-1' );

-- 字段说明:
--   uin                            TEXT            (主键)
--   is_reg                         INTEGER        
--   true_name                      TEXT           
--   card_num                       INTEGER        
--   isDomesticUser                 INTEGER        
--   cre_type                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   main_card_bind_serialno        TEXT           
--   ftf_pay_url                    TEXT           
--   switchConfig                   INTEGER        
--   reset_passwd_flag              TEXT            -- 标记
--   find_passwd_url                TEXT           
--   is_open_touch                  INTEGER        
--   lct_wording                    TEXT           
--   lct_url                        TEXT           
--   cre_name                       TEXT           
--   lqt_state                      INTEGER        
--   paymenu_use_new                INTEGER        
--   is_show_lqb                    INTEGER        
--   is_open_lqb                    INTEGER        
--   lqb_open_url                   TEXT           
--   lqt_cell_is_show               INTEGER        
--   lqt_cell_icon                  TEXT           
--   lqt_cell_is_open_lqt           INTEGER        
--   lqt_cell_lqt_open_url          TEXT           
--   lqt_cell_lqt_title             TEXT           
--   lqt_cell_lqt_wording           TEXT           
--   forget_passwd_url              TEXT           
--   unipay_order_state             INTEGER        
--   bank_priority                  TEXT           
--   wallet_balance                 LONG           
--   wallet_entrance_balance_switch_state INTEGER        
--   soter_pay_open_type            INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   authen_account_type            INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: WePkgDiffPackage
-- ========================================================
-- 记录数: 0

CREATE TABLE WePkgDiffPackage (  pkgId TEXT PRIMARY KEY ,  version TEXT,  oldVersion TEXT,  oldPath TEXT,  md5 TEXT,  downloadUrl TEXT,  pkgSize INTEGER,  downloadNetType INTEGER);

-- 字段说明:
--   pkgId                          TEXT            -- 自增ID (主键)
--   version                        TEXT            -- 群信息版本
--   oldVersion                     TEXT           
--   oldPath                        TEXT           
--   md5                            TEXT            -- MD5值
--   downloadUrl                    TEXT           
--   pkgSize                        INTEGER        
--   downloadNetType                INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: WebViewData
-- ========================================================
-- 记录数: 12

CREATE TABLE WebViewData (  appId TEXT,  appIdKey TEXT PRIMARY KEY ,  value TEXT,  weight TEXT,  expireTime LONG,  timeStamp LONG,  size LONG,  localFile TEXT);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID
--   appIdKey                       TEXT            -- 自增ID (主键)
--   value                          TEXT           
--   weight                         TEXT           
--   expireTime                     LONG            -- 过期时间
--   timeStamp                      LONG           
--   size                           LONG           
--   localFile                      TEXT           


-- ========================================================
-- 表名: WebViewHistory
-- ========================================================
-- 记录数: 0

CREATE TABLE WebViewHistory (  recordId TEXT PRIMARY KEY ,  link TEXT,  title TEXT,  source TEXT,  imgUrl TEXT,  timeStamp LONG);

-- 字段说明:
--   recordId                       TEXT            -- 自增ID (主键)
--   link                           TEXT           
--   title                          TEXT           
--   source                         TEXT            -- 来源扩展信息
--   imgUrl                         TEXT            -- CDN大图URL
--   timeStamp                      LONG           


-- ========================================================
-- 表名: WebViewHostsFilter
-- ========================================================
-- 记录数: 0

CREATE TABLE WebViewHostsFilter (  host TEXT,  expireTime LONG);

-- 字段说明:
--   host                           TEXT           
--   expireTime                     LONG            -- 过期时间


-- ========================================================
-- 表名: WebviewLocalData
-- ========================================================
-- 记录数: 0

CREATE TABLE WebviewLocalData (  recordId INTEGER PRIMARY KEY ,  appId TEXT,  domin TEXT,  key TEXT,  value TEXT);

-- 字段说明:
--   recordId                       INTEGER         -- 自增ID (主键)
--   appId                          TEXT            -- 开放IM应用ID
--   domin                          TEXT           
--   key                            TEXT            -- AES密钥
--   value                          TEXT           


-- ========================================================
-- 表名: WepkgPreloadFiles
-- ========================================================
-- 记录数: 0

CREATE TABLE WepkgPreloadFiles (  key TEXT PRIMARY KEY ,  pkgId TEXT,  version TEXT,  filePath TEXT,  rid TEXT,  mimeType TEXT,  md5 TEXT,  downloadUrl TEXT,  size INTEGER,  downloadNetType INTEGER,  completeDownload INTEGER default 'false' ,  createTime LONG,  autoDownloadCount INTEGER default '0' ,  fileDownloadCount INTEGER default '0' );

-- 字段说明:
--   key                            TEXT            -- AES密钥 (主键)
--   pkgId                          TEXT            -- 自增ID
--   version                        TEXT            -- 群信息版本
--   filePath                       TEXT           
--   rid                            TEXT            -- 消息服务器ID
--   mimeType                       TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   md5                            TEXT            -- MD5值
--   downloadUrl                    TEXT           
--   size                           INTEGER        
--   downloadNetType                INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   completeDownload               INTEGER        
--   createTime                     LONG            -- 创建时间
--   autoDownloadCount              INTEGER        
--   fileDownloadCount              INTEGER        


-- ========================================================
-- 表名: WepkgVersion
-- ========================================================
-- 记录数: 18

CREATE TABLE WepkgVersion (  pkgId TEXT PRIMARY KEY ,  appId TEXT,  version TEXT,  pkgPath TEXT,  disableWvCache INTEGER default 'true' ,  clearPkgTime LONG,  checkIntervalTime LONG,  packMethod INTEGER,  domain TEXT,  md5 TEXT,  downloadUrl TEXT,  pkgSize INTEGER,  downloadNetType INTEGER,  nextCheckTime LONG,  createTime LONG,  accessTime LONG default '0' ,  charset TEXT default 'UTF-8' ,  bigPackageReady INTEGER default 'false' ,  preloadFilesReady INTEGER default 'false' ,  preloadFilesAtomic INTEGER default 'false' ,  autoDownloadCount INTEGER default '0' ,  disable INTEGER default 'false' ,  totalDownloadCount INTEGER default '0' ,  packageDownloadCount INTEGER default '0' ,  downloadTriggerType INTEGER default '-1' );

-- 字段说明:
--   pkgId                          TEXT            -- 自增ID (主键)
--   appId                          TEXT            -- 开放IM应用ID
--   version                        TEXT            -- 群信息版本
--   pkgPath                        TEXT           
--   disableWvCache                 INTEGER        
--   clearPkgTime                   LONG           
--   checkIntervalTime              LONG           
--   packMethod                     INTEGER        
--   domain                         TEXT           
--   md5                            TEXT            -- MD5值
--   downloadUrl                    TEXT           
--   pkgSize                        INTEGER        
--   downloadNetType                INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   nextCheckTime                  LONG            -- 扩展
--   createTime                     LONG            -- 创建时间
--   accessTime                     LONG           
--   charset                        TEXT           
--   bigPackageReady                INTEGER        
--   preloadFilesReady              INTEGER        
--   preloadFilesAtomic             INTEGER        
--   autoDownloadCount              INTEGER        
--   disable                        INTEGER        
--   totalDownloadCount             INTEGER        
--   packageDownloadCount           INTEGER        
--   downloadTriggerType            INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: WeseeProviderInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE WeseeProviderInfo (  weSeeUri TEXT,  time LONG);

-- 字段说明:
--   weSeeUri                       TEXT           
--   time                           LONG            -- 是否显示时间


-- ========================================================
-- 表名: WxaTokenInfo
-- ========================================================
-- 记录数: 0

CREATE TABLE WxaTokenInfo (  token TEXT PRIMARY KEY ,  username TEXT,  uin INTEGER,  appid TEXT);

-- 字段说明:
--   token                          TEXT            (主键)
--   username                       TEXT            -- 用户名
--   uin                            INTEGER        
--   appid                          TEXT            -- 开放IM应用ID


-- ========================================================
-- 表名: addr_upload2
-- ========================================================
-- 记录数: 0

CREATE TABLE addr_upload2 ( id int  PRIMARY KEY , md5 text  , peopleid text  , uploadtime long  , realname text  , realnamepyinitial text  , realnamequanpin text  , username text  , nickname text  , nicknamepyinitial text  , nicknamequanpin text  , type int  , moblie text  , email text  , status int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int , lvbuf BLOG , showhead int  );

-- 字段说明:
--   id                             int             -- 自增ID (主键)
--   md5                            text            -- MD5值
--   peopleid                       text            -- 自增ID
--   uploadtime                     long           
--   realname                       text           
--   realnamepyinitial              text            -- 拼音首字母
--   realnamequanpin                text            -- 全拼
--   username                       text            -- 用户名
--   nickname                       text            -- 昵称
--   nicknamepyinitial              text            -- 昵称
--   nicknamequanpin                text            -- 昵称
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   moblie                         text           
--   email                          text           
--   status                         int             -- 消息状态
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4
--   lvbuf                          BLOG            -- 二进制数据
--   showhead                       int            


-- ========================================================
-- 表名: appattach
-- ========================================================
-- 记录数: 6,667

CREATE TABLE appattach (  appId TEXT,  sdkVer LONG,  mediaSvrId TEXT,  mediaId TEXT,  clientAppDataId TEXT,  type LONG,  totalLen LONG,  offset LONG,  status LONG,  isUpload INTEGER,  createTime LONG,  lastModifyTime LONG,  fileFullPath TEXT,  fullXml TEXT,  msgInfoId LONG,  netTimes LONG,  isUseCdn INTEGER,  signature TEXT,  fakeAeskey TEXT,  fakeSignature TEXT, msgInfoTalker TEXT);

-- 字段说明:
--   appId                          TEXT            -- 开放IM应用ID
--   sdkVer                         LONG           
--   mediaSvrId                     TEXT            -- 自增ID
--   mediaId                        TEXT            -- 自增ID
--   clientAppDataId                TEXT            -- 自增ID
--   type                           LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   totalLen                       LONG           
--   offset                         LONG           
--   status                         LONG            -- 消息状态
--   isUpload                       INTEGER        
--   createTime                     LONG            -- 创建时间
--   lastModifyTime                 LONG            -- 修改时间
--   fileFullPath                   TEXT           
--   fullXml                        TEXT            -- XML数据
--   msgInfoId                      LONG            -- 自增ID
--   netTimes                       LONG           
--   isUseCdn                       INTEGER        
--   signature                      TEXT            -- 个性签名
--   fakeAeskey                     TEXT            -- AES密钥
--   fakeSignature                  TEXT            -- 个性签名
--   msgInfoTalker                  TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: appbrandmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 48

CREATE TABLE appbrandmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: appbrandnotifymessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE appbrandnotifymessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: biz_photo_fans_img_info_table
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE biz_photo_fans_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT );

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   originSourceMd5                TEXT            -- MD5值
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: bizchatmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 66

CREATE TABLE bizchatmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT , talkerId INTEGER, bizClientMsgId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: bizfans_img_info_table
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizfans_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0 , originSourceMd5 TEXT, msgTalker TEXT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   originSourceMd5                TEXT            -- MD5值
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: bizfansmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizfansmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: bizfansvideoinfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizfansvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: bizfansvideoinfoVideoHash
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizfansvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: bizinfo
-- 说明: 公众号信息表
-- ========================================================
-- 记录数: 6,527

CREATE TABLE bizinfo (  username TEXT PRIMARY KEY ,  appId TEXT,  brandList TEXT default '' ,  brandListVersion TEXT,  brandListContent TEXT,  brandFlag INTEGER,  extInfo TEXT,  brandInfo TEXT,  brandIconURL TEXT,  updateTime LONG,  hadAlert INTEGER,  acceptType INTEGER default '0' ,  type INTEGER default '0' ,  status INTEGER default '0' ,  enterpriseFather TEXT,  kfWorkerId TEXT,  specialType INTEGER,  attrSyncVersion TEXT,  incrementUpdateTime LONG,  bitFlag INTEGER default '0' , aiReplyOpen INTEGER default '0', aiWording TEXT);

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   appId                          TEXT            -- 开放IM应用ID
--   brandList                      TEXT           
--   brandListVersion               TEXT           
--   brandListContent               TEXT            -- 消息内容
--   brandFlag                      INTEGER         -- 标记
--   extInfo                        TEXT            -- 来源扩展信息
--   brandInfo                      TEXT           
--   brandIconURL                   TEXT           
--   updateTime                     LONG            -- 更新时间
--   hadAlert                       INTEGER        
--   acceptType                     INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   enterpriseFather               TEXT           
--   kfWorkerId                     TEXT            -- 自增ID
--   specialType                    INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   attrSyncVersion                TEXT           
--   incrementUpdateTime            LONG            -- 更新时间
--   bitFlag                        INTEGER         -- 标记
--   aiReplyOpen                    INTEGER        
--   aiWording                      TEXT           


-- ========================================================
-- 表名: bizphotofansvideoinfo
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizphotofansvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: bizphotofansvideoinfoVideoHash
-- 说明: 公众号/企业号相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bizphotofansvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: bottlecontact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bottlecontact (  username TEXT default ''  PRIMARY KEY ,  alias TEXT default '' ,  conRemark TEXT default '' ,  domainList TEXT default '' ,  nickname TEXT default '' ,  pyInitial TEXT default '' ,  quanPin TEXT default '' ,  showHead INTEGER default '0' ,  type INTEGER default '0' ,  weiboFlag INTEGER default '0' ,  weiboNickname TEXT default '' ,  conRemarkPYFull TEXT default '' ,  conRemarkPYShort TEXT default '' ,  lvbuff BLOB,  verifyFlag INTEGER default '0' ,  encryptUsername TEXT default '' ,  chatroomFlag INTEGER,  deleteFlag INTEGER default '0' ,  contactLabelIds TEXT default '' ,  descWordingId TEXT default '' ,  openImAppid TEXT,  sourceExtInfo TEXT,  ticket TEXT default '' ,  usernameFlag LONG default '0' , uiType LONG default '0', contactExtra BLOB, createTime LONG default '0');

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   alias                          TEXT            -- 微信号
--   conRemark                      TEXT            -- 备注名
--   domainList                     TEXT           
--   nickname                       TEXT            -- 昵称
--   pyInitial                      TEXT            -- 拼音首字母
--   quanPin                        TEXT            -- 全拼
--   showHead                       INTEGER        
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   weiboFlag                      INTEGER         -- 标记
--   weiboNickname                  TEXT            -- 昵称
--   conRemarkPYFull                TEXT            -- 备注名
--   conRemarkPYShort               TEXT            -- 备注名
--   lvbuff                         BLOB            -- 二进制数据
--   verifyFlag                     INTEGER         -- 认证标志 (0=普通用户, 24=公众号, 56=企业号)
--   encryptUsername                TEXT            -- 加密用户名
--   chatroomFlag                   INTEGER         -- 群聊标志
--   deleteFlag                     INTEGER         -- 删除标志
--   contactLabelIds                TEXT            -- 联系人标签ID
--   descWordingId                  TEXT            -- 描述文字ID
--   openImAppid                    TEXT            -- 开放IM应用ID
--   sourceExtInfo                  TEXT            -- 来源扩展信息
--   ticket                         TEXT            -- 票据
--   usernameFlag                   LONG            -- 用户名标志
--   uiType                         LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   contactExtra                   BLOB            -- 额外数据
--   createTime                     LONG            -- 创建时间


-- ========================================================
-- 表名: bottleconversation
-- ========================================================
-- 记录数: 0

CREATE TABLE bottleconversation ( unReadCount INTEGER, status INT, isSend INT, createTime LONG, username VARCHAR(40), content TEXT, reserved TEXT );

-- 字段说明:
--   unReadCount                    INTEGER        
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   createTime                     LONG            -- 创建时间
--   username                       VARCHAR(40)     -- 用户名
--   content                        TEXT            -- 消息内容
--   reserved                       TEXT            -- 保留字段


-- ========================================================
-- 表名: bottleinfo1
-- ========================================================
-- 记录数: 0

CREATE TABLE bottleinfo1 ( parentclientid text  , childcount int  , bottleid text  PRIMARY KEY , bottletype int  , msgtype int  , voicelen int  , content text  , createtime long  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   parentclientid                 text            -- 自增ID
--   childcount                     int            
--   bottleid                       text            -- 自增ID (主键)
--   bottletype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   msgtype                        int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   voicelen                       int             -- 语音时长
--   content                        text            -- 消息内容
--   createtime                     long            -- 创建时间
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: bottlemessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE bottlemessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: chatroom
-- 说明: 群聊表 - 存储群聊信息
-- ========================================================
-- 记录数: 573

CREATE TABLE chatroom (  chatroomname TEXT default ''  PRIMARY KEY ,  addtime LONG,  memberlist TEXT,  displayname TEXT,  chatroomnick TEXT,  roomflag INTEGER,  roomowner TEXT,  roomdata BLOB,  isShowname INTEGER,  selfDisplayName TEXT,  style INTEGER,  chatroomdataflag INTEGER,  modifytime LONG,  chatroomnotice TEXT,  chatroomVersion INTEGER,  chatroomnoticeEditor TEXT,  chatroomnoticePublishTime LONG,  chatroomNoticeNew INTEGER,  chatroomLocalVersion LONG,  chatroomStatus INTEGER default '0' ,  memberCount INTEGER default '-1' ,  chatroomfamilystatusmodifytime LONG default '0' ,  associateOpenIMRoomName TEXT,  openIMRoomMigrateStatus INTEGER default '0' ,  saveByteVersion TEXT,  handleByteVersion TEXT,  roomInfoDetailResByte BLOB,  oldChatroomVersion INTEGER,  localChatRoomWatchMembers BLOB,  spamStatus INTEGER default '0' , xmlChatroomnotice TEXT, compactFlag LONG default '0', qrCodeAccessType INTEGER default '0');

-- 字段说明:
--   chatroomname                   TEXT            -- 群聊名称 (主键)
--   addtime                        LONG           
--   memberlist                     TEXT            -- 成员列表
--   displayname                    TEXT           
--   chatroomnick                   TEXT            -- 群昵称
--   roomflag                       INTEGER         -- 标记
--   roomowner                      TEXT            -- 群主
--   roomdata                       BLOB            -- 数据
--   isShowname                     INTEGER        
--   selfDisplayName                TEXT           
--   style                          INTEGER        
--   chatroomdataflag               INTEGER         -- 标记
--   modifytime                     LONG            -- 修改时间
--   chatroomnotice                 TEXT            -- 群公告
--   chatroomVersion                INTEGER        
--   chatroomnoticeEditor           TEXT            -- 群公告
--   chatroomnoticePublishTime      LONG            -- 群公告
--   chatroomNoticeNew              INTEGER         -- 群公告
--   chatroomLocalVersion           LONG           
--   chatroomStatus                 INTEGER         -- 消息状态
--   memberCount                    INTEGER         -- 成员数量
--   chatroomfamilystatusmodifytime LONG            -- 消息状态
--   associateOpenIMRoomName        TEXT           
--   openIMRoomMigrateStatus        INTEGER         -- 消息状态
--   saveByteVersion                TEXT           
--   handleByteVersion              TEXT           
--   roomInfoDetailResByte          BLOB           
--   oldChatroomVersion             INTEGER        
--   localChatRoomWatchMembers      BLOB           
--   spamStatus                     INTEGER         -- 消息状态
--   xmlChatroomnotice              TEXT            -- 群公告
--   compactFlag                    LONG            -- 标记
--   qrCodeAccessType               INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)


-- ========================================================
-- 表名: chattingbginfo
-- ========================================================
-- 记录数: 2

CREATE TABLE chattingbginfo ( username text  PRIMARY KEY , bgflag int  , path text  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  );

-- 字段说明:
--   username                       text            -- 用户名 (主键)
--   bgflag                         int             -- 标记
--   path                           text            -- 图片路径
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: contact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE contact ( contactID INTEGER PRIMARY KEY, sex INT, type INT, showHead INT, username VARCHAR(40), nickname VARCHAR(40), pyInitial VARCHAR(40), quanPin VARCHAR(60), reserved TEXT );

-- 字段说明:
--   contactID                      INTEGER         -- 自增ID (主键)
--   sex                            INT             -- 性别 (0=未知, 1=男, 2=女)
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   showHead                       INT            
--   username                       VARCHAR(40)     -- 用户名
--   nickname                       VARCHAR(40)     -- 昵称
--   pyInitial                      VARCHAR(40)     -- 拼音首字母
--   quanPin                        VARCHAR(60)     -- 全拼
--   reserved                       TEXT            -- 保留字段


-- ========================================================
-- 表名: contact_ext
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE contact_ext ( username VARCHAR(40), Uin INTEGER DEFAULT 0, Email VARCHAR(128), Mobile VARCHAR(40), ShowFlag INTEGER DEFAULT 0 , ConType INTEGER DEFAULT 0 , ConRemark TEXT, ConRemark_PYShort TEXT, ConRemark_PYFull TEXT, ConQQMBlog TEXT, ConSMBlog TEXT, DomainList TEXT, reserved1 INT DEFAULT 0 , reserved2 INT DEFAULT 0 , reserved3 INT DEFAULT 0 , reserved4 INT DEFAULT 0 , reserved5 INT DEFAULT 0 , reserved6 TEXT, reserved7 TEXT, reserved8 TEXT, reserved9 TEXT, reserved10 TEXT, weiboflag  INT DEFAULT 0 ,weibonickname TEXT  );

-- 字段说明:
--   username                       VARCHAR(40)     -- 用户名
--   Uin                            INTEGER        
--   Email                          VARCHAR(128)   
--   Mobile                         VARCHAR(40)    
--   ShowFlag                       INTEGER         -- 标记
--   ConType                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   ConRemark                      TEXT            -- 备注名
--   ConRemark_PYShort              TEXT            -- 备注名
--   ConRemark_PYFull               TEXT            -- 备注名
--   ConQQMBlog                     TEXT           
--   ConSMBlog                      TEXT           
--   DomainList                     TEXT           
--   reserved1                      INT             -- 保留字段1
--   reserved2                      INT             -- 保留字段2
--   reserved3                      INT             -- 保留字段3
--   reserved4                      INT             -- 保留字段4
--   reserved5                      INT             -- 保留字段
--   reserved6                      TEXT            -- 保留字段
--   reserved7                      TEXT            -- 保留字段
--   reserved8                      TEXT            -- 保留字段
--   reserved9                      TEXT            -- 保留字段
--   reserved10                     TEXT            -- 保留字段
--   weiboflag                      INT             -- 标记
--   weibonickname                  TEXT            -- 昵称


-- ========================================================
-- 表名: conversation
-- ========================================================
-- 记录数: 0

CREATE TABLE conversation ( unReadCount INTEGER, status INT, isSend INT, createTime LONG, username VARCHAR(40), content TEXT, reserved TEXT );

-- 字段说明:
--   unReadCount                    INTEGER        
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   createTime                     LONG            -- 创建时间
--   username                       VARCHAR(40)     -- 用户名
--   content                        TEXT            -- 消息内容
--   reserved                       TEXT            -- 保留字段


-- ========================================================
-- 表名: facebookfriend
-- ========================================================
-- 记录数: 0

CREATE TABLE facebookfriend ( fbid long  PRIMARY KEY , fbname text  , fbimgkey int  , status int  , username text  , nickname text  , nicknamepyinitial text  , nicknamequanpin text  , sex int  , personalcard int  , province text  , city text  , signature text  , alias text  , type int  , email text  );

-- 字段说明:
--   fbid                           long            -- 自增ID (主键)
--   fbname                         text           
--   fbimgkey                       int            
--   status                         int             -- 消息状态
--   username                       text            -- 用户名
--   nickname                       text            -- 昵称
--   nicknamepyinitial              text            -- 昵称
--   nicknamequanpin                text            -- 昵称
--   sex                            int             -- 性别 (0=未知, 1=男, 2=女)
--   personalcard                   int            
--   province                       text            -- 省份
--   city                           text            -- 城市
--   signature                      text            -- 个性签名
--   alias                          text            -- 微信号
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   email                          text           


-- ========================================================
-- 表名: finder_img_info_table
-- 说明: 图片相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE finder_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0 , originSourceMd5 TEXT, msgTalker TEXT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   originSourceMd5                TEXT            -- MD5值
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: findermessage006
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 22

CREATE TABLE findermessage006 (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: findervideoinfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE findervideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text , share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: findervideoinfoVideoHash
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE findervideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: fmessage_conversation
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 635

CREATE TABLE fmessage_conversation (  talker TEXT default '0'  PRIMARY KEY ,  encryptTalker TEXT default '' ,  displayName TEXT default '' ,  state INTEGER default '0' ,  lastModifiedTime LONG default '0' ,  isNew INTEGER default '0' ,  addScene INTEGER default '0' ,  fmsgSysRowId LONG default '0' ,  fmsgIsSend INTEGER default '0' ,  fmsgType INTEGER default '0' ,  fmsgContent TEXT default '' ,  recvFmsgType INTEGER default '0' ,  contentFromUsername TEXT default '' ,  contentNickname TEXT default '' ,  contentPhoneNumMD5 TEXT default '' ,  contentFullPhoneNumMD5 TEXT default '' ,  contentVerifyContent TEXT default '' , fmsgIsHasShowSelfQRCode INTEGER default '0');

-- 字段说明:
--   talker                         TEXT            -- 对话者ID (wxid或群ID) (主键)
--   encryptTalker                  TEXT            -- 对话者ID (wxid或群ID)
--   displayName                    TEXT           
--   state                          INTEGER        
--   lastModifiedTime               LONG           
--   isNew                          INTEGER        
--   addScene                       INTEGER        
--   fmsgSysRowId                   LONG            -- 自增ID
--   fmsgIsSend                     INTEGER         -- 是否发送 (0=接收, 1=发送)
--   fmsgType                       INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   fmsgContent                    TEXT            -- 消息内容
--   recvFmsgType                   INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   contentFromUsername            TEXT            -- 消息内容
--   contentNickname                TEXT            -- 消息内容
--   contentPhoneNumMD5             TEXT            -- 消息内容
--   contentFullPhoneNumMD5         TEXT            -- 消息内容
--   contentVerifyContent           TEXT            -- 消息内容
--   fmsgIsHasShowSelfQRCode        INTEGER        


-- ========================================================
-- 表名: fmessage_msginfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 706

CREATE TABLE fmessage_msginfo (  msgContent TEXT default '' ,  isSend INTEGER default '0' ,  talker TEXT default '' ,  encryptTalker TEXT default '' ,  svrId LONG default '0' ,  type INTEGER default '0' ,  createTime LONG default '0' ,  chatroomName TEXT default '' , isContactDeleted INTEGER default '0');

-- 字段说明:
--   msgContent                     TEXT            -- 消息内容
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   encryptTalker                  TEXT            -- 对话者ID (wxid或群ID)
--   svrId                          LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createTime                     LONG            -- 创建时间
--   chatroomName                   TEXT            -- 群聊名称
--   isContactDeleted               INTEGER        


-- ========================================================
-- 表名: friend_ext
-- ========================================================
-- 记录数: 0

CREATE TABLE friend_ext ( username text  PRIMARY KEY , sex int  , personalcard int  , province text  , city text  , signature text  , reserved1 text  , reserved2 text  , reserved3 text  , reserved4 text  , reserved5 int  , reserved6 int  , reserved7 int  , reserved8 int  );

-- 字段说明:
--   username                       text            -- 用户名 (主键)
--   sex                            int             -- 性别 (0=未知, 1=男, 2=女)
--   personalcard                   int            
--   province                       text            -- 省份
--   city                           text            -- 城市
--   signature                      text            -- 个性签名
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   reserved5                      int             -- 保留字段
--   reserved6                      int             -- 保留字段
--   reserved7                      int             -- 保留字段
--   reserved8                      int             -- 保留字段


-- ========================================================
-- 表名: gamelife_img_info_table
-- 说明: 图片相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE gamelife_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0 , originSourceMd5 TEXT, msgTalker TEXT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   originSourceMd5                TEXT            -- MD5值
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: gamelifemessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 3

CREATE TABLE gamelifemessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: gamelifevideoinfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE gamelifevideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text , share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: gamelifevideoinfoVideoHash
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE gamelifevideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: getcontactinfov2
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE getcontactinfov2 ( username text  PRIMARY KEY , inserttime long  , type int  , lastgettime int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   username                       text            -- 用户名 (主键)
--   inserttime                     long           
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   lastgettime                    int            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: hdheadimginfo
-- 说明: 图片相关表
-- ========================================================
-- 记录数: 31

CREATE TABLE hdheadimginfo ( username text  PRIMARY KEY , imgwidth int  , imgheigth int  , imgformat text  , totallen int  , startpos int  , headimgtype int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  );

-- 字段说明:
--   username                       text            -- 用户名 (主键)
--   imgwidth                       int             -- 自增ID
--   imgheigth                      int            
--   imgformat                      text           
--   totallen                       int            
--   startpos                       int            
--   headimgtype                    int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: img_flag
-- 说明: 图片标记表
-- ========================================================
-- 记录数: 37,460

CREATE TABLE img_flag ( username VARCHAR(40) PRIMARY KEY , imgflag int , lastupdatetime int , reserved1 text ,reserved2 text ,reserved3 int ,reserved4 int , updateflag int default 0);

-- 字段说明:
--   username                       VARCHAR(40)     -- 用户名 (主键)
--   imgflag                        int             -- 标记
--   lastupdatetime                 int             -- 更新时间
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4
--   updateflag                     int             -- 标记


-- ========================================================
-- 表名: invitefriendopen
-- ========================================================
-- 记录数: 0

CREATE TABLE invitefriendopen ( username text  PRIMARY KEY , friendtype int  , updatetime int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   username                       text            -- 用户名 (主键)
--   friendtype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   updatetime                     int             -- 更新时间
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: massendinfo
-- ========================================================
-- 记录数: 0

CREATE TABLE massendinfo ( clientid text  PRIMARY KEY , status int  , createtime long  , lastmodifytime long  , filename text  , thumbfilename text  , tolist text  , tolistcount int  , msgtype int  , mediatime int  , datanetoffset int  , datalen int  , thumbnetoffset int  , thumbtotallen int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   clientid                       text            -- 自增ID (主键)
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   filename                       text           
--   thumbfilename                  text           
--   tolist                         text           
--   tolistcount                    int            
--   msgtype                        int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   mediatime                      int            
--   datanetoffset                  int             -- 数据
--   datalen                        int             -- 数据
--   thumbnetoffset                 int            
--   thumbtotallen                  int            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: message
-- 说明: 聊天消息表 - 存储所有聊天消息
-- ========================================================
-- 记录数: 1,475,129

CREATE TABLE message ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT,transBrandWording TEXT ,talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: netstat
-- ========================================================
-- 记录数: 1,437

CREATE TABLE netstat ( id INTEGER PRIMARY KEY, peroid INT, textCountIn INT, textBytesIn INT, imageCountIn INT, imageBytesIn INT, voiceCountIn INT, voiceBytesIn INT, videoCountIn INT, videoBytesIn INT, mobileBytesIn INT, wifiBytesIn INT, sysMobileBytesIn INT, sysWifiBytesIn INT, textCountOut INT, textBytesOut INT, imageCountOut INT, imageBytesOut INT, voiceCountOut INT, voiceBytesOut INT, videoCountOut INT, videoBytesOut INT, mobileBytesOut INT, wifiBytesOut INT, sysMobileBytesOut INT, sysWifiBytesOut INT, reserved1 INT, reserved2 INT, reserved3 TEXT, realMobileBytesIn INT, realWifiBytesIn INT, realMobileBytesOut INT, realWifiBytesOut INT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   peroid                         INT             -- 自增ID
--   textCountIn                    INT             -- 扩展
--   textBytesIn                    INT             -- 扩展
--   imageCountIn                   INT            
--   imageBytesIn                   INT            
--   voiceCountIn                   INT            
--   voiceBytesIn                   INT            
--   videoCountIn                   INT             -- 自增ID
--   videoBytesIn                   INT             -- 自增ID
--   mobileBytesIn                  INT            
--   wifiBytesIn                    INT            
--   sysMobileBytesIn               INT            
--   sysWifiBytesIn                 INT            
--   textCountOut                   INT             -- 扩展
--   textBytesOut                   INT             -- 扩展
--   imageCountOut                  INT            
--   imageBytesOut                  INT            
--   voiceCountOut                  INT            
--   voiceBytesOut                  INT            
--   videoCountOut                  INT             -- 自增ID
--   videoBytesOut                  INT             -- 自增ID
--   mobileBytesOut                 INT            
--   wifiBytesOut                   INT            
--   sysMobileBytesOut              INT            
--   sysWifiBytesOut                INT            
--   reserved1                      INT             -- 保留字段1
--   reserved2                      INT             -- 保留字段2
--   reserved3                      TEXT            -- 保留字段3
--   realMobileBytesIn              INT            
--   realWifiBytesIn                INT            
--   realMobileBytesOut             INT            
--   realWifiBytesOut               INT            


-- ========================================================
-- 表名: oplog2
-- ========================================================
-- 记录数: 3

CREATE TABLE oplog2 ( id INTEGER PRIMARY KEY , inserTime long , cmdId int , buffer blob , reserved1 int , reserved2 long , reserved3 text , reserved4 text );

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   inserTime                      long           
--   cmdId                          int             -- 自增ID
--   buffer                         blob            -- 二进制数据
--   reserved1                      int             -- 保留字段1
--   reserved2                      long            -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: packageinfo
-- ========================================================
-- 记录数: 0

CREATE TABLE packageinfo ( id int  PRIMARY KEY, version int  , name text  , size int  , packname text  , status int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  );

-- 字段说明:
--   id                             int             -- 自增ID (主键)
--   version                        int             -- 群信息版本
--   name                           text            -- 用户名
--   size                           int            
--   packname                       text           
--   status                         int             -- 消息状态
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: packageinfo2
-- ========================================================
-- 记录数: 16

CREATE TABLE packageinfo2 ( localId text  PRIMARY KEY , id int  , version int  , name text  , size int  , packname text  , status int  , type int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  );

-- 字段说明:
--   localId                        text            -- 消息本地ID (主键)
--   id                             int             -- 自增ID
--   version                        int             -- 群信息版本
--   name                           text            -- 用户名
--   size                           int            
--   packname                       text           
--   status                         int             -- 消息状态
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: picfansmsg
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE picfansmsg (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: qmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE qmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: qqgroup
-- ========================================================
-- 记录数: 0

CREATE TABLE qqgroup ( grouopid int PRIMARY KEY,membernum int,weixinnum int,insert_time int,lastupdate_time int,needupdate int,updatekey text,groupname text,reserved1 text ,reserved2 text ,reserved3 int ,reserved4 int );

-- 字段说明:
--   grouopid                       int             -- 自增ID (主键)
--   membernum                      int            
--   weixinnum                      int            
--   insert_time                    int            
--   lastupdate_time                int            
--   needupdate                     int            
--   updatekey                      text           
--   groupname                      text           
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: qqlist
-- ========================================================
-- 记录数: 0

CREATE TABLE qqlist ( qq long  PRIMARY KEY , wexinstatus int  , groupid int  , username text  , nickname text  , pyinitial text  , quanpin text  , qqnickname text  , qqpyinitial text  , qqquanpin text  , qqremark text  , qqremarkpyinitial text  , qqremarkquanpin text  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  );

-- 字段说明:
--   qq                             long            (主键)
--   wexinstatus                    int             -- 消息状态
--   groupid                        int             -- 自增ID
--   username                       text            -- 用户名
--   nickname                       text            -- 昵称
--   pyinitial                      text            -- 拼音首字母
--   quanpin                        text            -- 全拼
--   qqnickname                     text            -- 昵称
--   qqpyinitial                    text            -- 拼音首字母
--   qqquanpin                      text            -- 全拼
--   qqremark                       text           
--   qqremarkpyinitial              text            -- 拼音首字母
--   qqremarkquanpin                text            -- 全拼
--   reserved1                      text            -- 保留字段1
--   reserved2                      text            -- 保留字段2
--   reserved3                      int             -- 保留字段3
--   reserved4                      int             -- 保留字段4


-- ========================================================
-- 表名: rbottleconversation
-- ========================================================
-- 记录数: 0

CREATE TABLE rbottleconversation (  msgCount INTEGER default '0' ,  username TEXT default ''  PRIMARY KEY ,  unReadCount INTEGER default '0' ,  chatmode INTEGER default '0' ,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  conversationTime LONG default '0' ,  content TEXT default '' ,  msgType TEXT default '' ,  customNotify TEXT default '' ,  showTips INTEGER default '0' ,  flag LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  hasTrunc INTEGER default '0' ,  parentRef TEXT,  attrflag INTEGER default '0' ,  editingMsg TEXT default '' ,  atCount INTEGER default '0' ,  sightTime LONG default '0' ,  unReadMuteCount INTEGER default '0' ,  lastSeq LONG,  UnDeliverCount INTEGER,  UnReadInvite INTEGER,  firstUnDeliverSeq LONG,  editingQuoteMsgId LONG default '0' ,  hasTodo INTEGER default '0' ,  hbMarkRed INTEGER default '0' ,  remitMarkRed INTEGER default '0' ,  hasSpecialFollow INTEGER default '0' );

-- 字段说明:
--   msgCount                       INTEGER        
--   username                       TEXT            -- 用户名 (主键)
--   unReadCount                    INTEGER        
--   chatmode                       INTEGER        
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   conversationTime               LONG           
--   content                        TEXT            -- 消息内容
--   msgType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   customNotify                   TEXT           
--   showTips                       INTEGER        
--   flag                           LONG            -- 标记
--   digest                         TEXT           
--   digestUser                     TEXT           
--   hasTrunc                       INTEGER        
--   parentRef                      TEXT           
--   attrflag                       INTEGER         -- 标记
--   editingMsg                     TEXT           
--   atCount                        INTEGER        
--   sightTime                      LONG           
--   unReadMuteCount                INTEGER        
--   lastSeq                        LONG           
--   UnDeliverCount                 INTEGER        
--   UnReadInvite                   INTEGER        
--   firstUnDeliverSeq              LONG           
--   editingQuoteMsgId              LONG            -- 消息ID (本地)
--   hasTodo                        INTEGER        
--   hbMarkRed                      INTEGER        
--   remitMarkRed                   INTEGER        
--   hasSpecialFollow               INTEGER        


-- ========================================================
-- 表名: rcontact
-- 说明: 联系人表 - 存储所有联系人信息
-- ========================================================
-- 记录数: 36,477

CREATE TABLE rcontact (  username TEXT default ''  PRIMARY KEY ,  alias TEXT default '' ,  conRemark TEXT default '' ,  domainList TEXT default '' ,  nickname TEXT default '' ,  pyInitial TEXT default '' ,  quanPin TEXT default '' ,  showHead INTEGER default '0' ,  type INTEGER default '0' ,  weiboFlag INTEGER default '0' ,  weiboNickname TEXT default '' ,  conRemarkPYFull TEXT default '' ,  conRemarkPYShort TEXT default '' ,  lvbuff BLOB,  verifyFlag INTEGER default '0' ,  encryptUsername TEXT default '' ,  chatroomFlag INTEGER,  deleteFlag INTEGER default '0' ,  contactLabelIds TEXT default '' ,  descWordingId TEXT default '' ,  openImAppid TEXT,  sourceExtInfo TEXT,  ticket TEXT default '' ,  usernameFlag LONG default '0' , uiType LONG default '0', contactExtra BLOB, createTime LONG default '0');

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   alias                          TEXT            -- 微信号
--   conRemark                      TEXT            -- 备注名
--   domainList                     TEXT           
--   nickname                       TEXT            -- 昵称
--   pyInitial                      TEXT            -- 拼音首字母
--   quanPin                        TEXT            -- 全拼
--   showHead                       INTEGER        
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   weiboFlag                      INTEGER         -- 标记
--   weiboNickname                  TEXT            -- 昵称
--   conRemarkPYFull                TEXT            -- 备注名
--   conRemarkPYShort               TEXT            -- 备注名
--   lvbuff                         BLOB            -- 二进制数据
--   verifyFlag                     INTEGER         -- 认证标志 (0=普通用户, 24=公众号, 56=企业号)
--   encryptUsername                TEXT            -- 加密用户名
--   chatroomFlag                   INTEGER         -- 群聊标志
--   deleteFlag                     INTEGER         -- 删除标志
--   contactLabelIds                TEXT            -- 联系人标签ID
--   descWordingId                  TEXT            -- 描述文字ID
--   openImAppid                    TEXT            -- 开放IM应用ID
--   sourceExtInfo                  TEXT            -- 来源扩展信息
--   ticket                         TEXT            -- 票据
--   usernameFlag                   LONG            -- 用户名标志
--   uiType                         LONG            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   contactExtra                   BLOB            -- 额外数据
--   createTime                     LONG            -- 创建时间


-- ========================================================
-- 表名: rconversation
-- ========================================================
-- 记录数: 2,039

CREATE TABLE rconversation (  msgCount INTEGER default '0' ,  username TEXT default ''  PRIMARY KEY ,  unReadCount INTEGER default '0' ,  chatmode INTEGER default '0' ,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  conversationTime LONG default '0' ,  content TEXT default '' ,  msgType TEXT default '' ,  customNotify TEXT default '' ,  showTips INTEGER default '0' ,  flag LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  hasTrunc INTEGER default '0' ,  parentRef TEXT,  attrflag INTEGER default '0' ,  editingMsg TEXT default '' ,  atCount INTEGER default '0' ,  sightTime LONG default '0' ,  unReadMuteCount INTEGER default '0' ,  lastSeq LONG,  UnDeliverCount INTEGER,  UnReadInvite INTEGER,  firstUnDeliverSeq LONG,  editingQuoteMsgId LONG default '0' ,  hasTodo INTEGER default '0' ,  hbMarkRed INTEGER default '0' ,  remitMarkRed INTEGER default '0' ,  hasSpecialFollow INTEGER default '0' );

-- 字段说明:
--   msgCount                       INTEGER        
--   username                       TEXT            -- 用户名 (主键)
--   unReadCount                    INTEGER        
--   chatmode                       INTEGER        
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   conversationTime               LONG           
--   content                        TEXT            -- 消息内容
--   msgType                        TEXT            -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   customNotify                   TEXT           
--   showTips                       INTEGER        
--   flag                           LONG            -- 标记
--   digest                         TEXT           
--   digestUser                     TEXT           
--   hasTrunc                       INTEGER        
--   parentRef                      TEXT           
--   attrflag                       INTEGER         -- 标记
--   editingMsg                     TEXT           
--   atCount                        INTEGER        
--   sightTime                      LONG           
--   unReadMuteCount                INTEGER        
--   lastSeq                        LONG           
--   UnDeliverCount                 INTEGER        
--   UnReadInvite                   INTEGER        
--   firstUnDeliverSeq              LONG           
--   editingQuoteMsgId              LONG            -- 消息ID (本地)
--   hasTodo                        INTEGER        
--   hbMarkRed                      INTEGER        
--   remitMarkRed                   INTEGER        
--   hasSpecialFollow               INTEGER        


-- ========================================================
-- 表名: readerappnews1
-- ========================================================
-- 记录数: 943

CREATE TABLE readerappnews1 ( tweetid text  PRIMARY KEY , time long  , type int  , name text  , title text  , url text  , shorturl text  , longurl text  , pubtime long  , sourcename text  , sourceicon text  , istop int  , cover text  , digest text  , reserved1 int  , reserved2 long  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   tweetid                        text            -- 自增ID (主键)
--   time                           long            -- 是否显示时间
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   name                           text            -- 用户名
--   title                          text           
--   url                            text            -- CDN大图URL
--   shorturl                       text           
--   longurl                        text           
--   pubtime                        long           
--   sourcename                     text           
--   sourceicon                     text           
--   istop                          int            
--   cover                          text           
--   digest                         text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      long            -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: readerappweibo
-- ========================================================
-- 记录数: 0

CREATE TABLE readerappweibo ( tweetid text  PRIMARY KEY , time long  , type int  , name text  , title text  , url text  , shorturl text  , longurl text  , pubtime long  , sourcename text  , sourceicon text  , istop int  , cover text  , digest text  , reserved1 int  , reserved2 long  , reserved3 text  , reserved4 text  );

-- 字段说明:
--   tweetid                        text            -- 自增ID (主键)
--   time                           long            -- 是否显示时间
--   type                           int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   name                           text            -- 用户名
--   title                          text           
--   url                            text            -- CDN大图URL
--   shorturl                       text           
--   longurl                        text           
--   pubtime                        long           
--   sourcename                     text           
--   sourceicon                     text           
--   istop                          int            
--   cover                          text           
--   digest                         text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      long            -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: role_info
-- ========================================================
-- 记录数: 1

CREATE TABLE role_info ( id TEXT PRIMARY KEY, name TEXT, status INT, text_reserved1 TEXT, text_reserved2 TEXT, text_reserved3 TEXT, text_reserved4 TEXT, int_reserved1 INT, int_reserved2 INT, int_reserved3 INT, int_reserved4 INT );

-- 字段说明:
--   id                             TEXT            -- 自增ID (主键)
--   name                           TEXT            -- 用户名
--   status                         INT             -- 消息状态
--   text_reserved1                 TEXT            -- 保留字段
--   text_reserved2                 TEXT            -- 保留字段
--   text_reserved3                 TEXT            -- 保留字段
--   text_reserved4                 TEXT            -- 保留字段
--   int_reserved1                  INT             -- 保留字段
--   int_reserved2                  INT             -- 保留字段
--   int_reserved3                  INT             -- 保留字段
--   int_reserved4                  INT             -- 保留字段


-- ========================================================
-- 表名: shakeitem1
-- ========================================================
-- 记录数: 7

CREATE TABLE shakeitem1 (  shakeItemID INTEGER default '0'  PRIMARY KEY ,  username TEXT,  nickname TEXT,  province TEXT,  city TEXT,  signature TEXT,  distance TEXT,  sex INTEGER,  imgstatus INTEGER,  hasHDImg INTEGER,  insertBatch INTEGER,  reserved1 INTEGER,  reserved2 INTEGER,  reserved3 TEXT,  reserved4 TEXT,  type INTEGER,  lvbuffer BLOB,  regionCode TEXT,  snsFlag INTEGER,  sns_bgurl TEXT);

-- 字段说明:
--   shakeItemID                    INTEGER         -- 自增ID (主键)
--   username                       TEXT            -- 用户名
--   nickname                       TEXT            -- 昵称
--   province                       TEXT            -- 省份
--   city                           TEXT            -- 城市
--   signature                      TEXT            -- 个性签名
--   distance                       TEXT           
--   sex                            INTEGER         -- 性别 (0=未知, 1=男, 2=女)
--   imgstatus                      INTEGER         -- 消息状态
--   hasHDImg                       INTEGER        
--   insertBatch                    INTEGER        
--   reserved1                      INTEGER         -- 保留字段1
--   reserved2                      INTEGER         -- 保留字段2
--   reserved3                      TEXT            -- 保留字段3
--   reserved4                      TEXT            -- 保留字段4
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   lvbuffer                       BLOB            -- 二进制数据
--   regionCode                     TEXT           
--   snsFlag                        INTEGER         -- 标记
--   sns_bgurl                      TEXT           


-- ========================================================
-- 表名: shakemessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE shakemessage (  svrid LONG default '0'  PRIMARY KEY ,  type INTEGER,  subtype INTEGER default '0' ,  createtime LONG,  tag TEXT,  status INTEGER,  title TEXT,  desc TEXT,  thumburl TEXT,  reserved1 TEXT,  reserved2 TEXT,  reserved3 INTEGER,  reservedBuf BLOB);

-- 字段说明:
--   svrid                          LONG            -- 消息服务器ID (主键)
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   subtype                        INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   createtime                     LONG            -- 创建时间
--   tag                            TEXT           
--   status                         INTEGER         -- 消息状态
--   title                          TEXT           
--   desc                           TEXT            -- 描述文字ID
--   thumburl                       TEXT            -- CDN缩略图URL
--   reserved1                      TEXT            -- 保留字段1
--   reserved2                      TEXT            -- 保留字段2
--   reserved3                      INTEGER         -- 保留字段3
--   reservedBuf                    BLOB            -- 保留字段


-- ========================================================
-- 表名: shaketvhistory
-- ========================================================
-- 记录数: 0

CREATE TABLE shaketvhistory (  username TEXT default ''  PRIMARY KEY ,  deeplink TEXT default '' ,  title TEXT default '' ,  iconurl TEXT default '' ,  createtime LONG default '' );

-- 字段说明:
--   username                       TEXT            -- 用户名 (主键)
--   deeplink                       TEXT           
--   title                          TEXT           
--   iconurl                        TEXT           
--   createtime                     LONG            -- 创建时间


-- ========================================================
-- 表名: shakeverifymessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE shakeverifymessage (  svrid LONG default '0'  PRIMARY KEY ,  status INTEGER,  type INTEGER,  scene INTEGER,  createtime LONG,  talker TEXT,  content TEXT,  sayhiuser TEXT,  sayhicontent TEXT,  imgpath TEXT,  isSend INTEGER);

-- 字段说明:
--   svrid                          LONG            -- 消息服务器ID (主键)
--   status                         INTEGER         -- 消息状态
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   scene                          INTEGER        
--   createtime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   sayhiuser                      TEXT           
--   sayhicontent                   TEXT            -- 消息内容
--   imgpath                        TEXT            -- 图片路径
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)


-- ========================================================
-- 表名: textstatusmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE textstatusmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: textstatusvideoinfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE textstatusvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text , share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: textstatusvideoinfoVideoHash
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE textstatusvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           


-- ========================================================
-- 表名: tmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE tmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT);

-- 字段说明:
--   msgId                          INTEGER         -- 消息ID (本地) (主键)
--   msgSvrId                       INTEGER         -- 消息服务器ID
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INT             -- 消息状态
--   isSend                         INT             -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     INTEGER         -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   talkerId                       INTEGER         -- 对话者数字ID
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      INTEGER         -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         INTEGER         -- 消息序列号
--   flag                           INT             -- 标记
--   solitaireFoldInfo              BLOB            -- 接龙折叠信息
--   historyId                      TEXT            -- 历史ID


-- ========================================================
-- 表名: userinfo
-- 说明: 用户信息表 - 存储当前用户信息
-- ========================================================
-- 记录数: 234

CREATE TABLE userinfo ( id INTEGER PRIMARY KEY, type INT, value TEXT );

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   value                          TEXT           


-- ========================================================
-- 表名: userinfo2
-- ========================================================
-- 记录数: 792

CREATE TABLE userinfo2 ( sid TEXT PRIMARY KEY, type INT, value TEXT );

-- 字段说明:
--   sid                            TEXT            -- 朋友圈动态ID (主键)
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   value                          TEXT           


-- ========================================================
-- 表名: verifycontact
-- 说明: 联系人相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE verifycontact ( id INTEGER PRIMARY KEY, username varchar(40), nickname varchar(40), fullpy varchar(60), shortpy varchar(40), imgflag int, scene int, content text, status int, reserved1 int,reserved2 int,reserved3 text,reserved4 text);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   username                       varchar(40)     -- 用户名
--   nickname                       varchar(40)     -- 昵称
--   fullpy                         varchar(60)    
--   shortpy                        varchar(40)    
--   imgflag                        int             -- 标记
--   scene                          int            
--   content                        text            -- 消息内容
--   status                         int             -- 消息状态
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4


-- ========================================================
-- 表名: videoinfo
-- 说明: 视频相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE videoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int, msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int , media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: videoinfo2
-- 说明: 视频信息表 - 存储视频消息详情
-- ========================================================
-- 记录数: 31,311

CREATE TABLE videoinfo2 ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text,share_app_info text, origin_file_name text, had_clicked_video int, media_id text , media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: voiceinfo
-- 说明: 语音信息表 - 存储语音消息详情
-- ========================================================
-- 记录数: 9,456

CREATE TABLE voiceinfo ( FileName TEXT PRIMARY KEY, User TEXT, MsgId INT, NetOffset INT, FileNowSize INT, TotalLen INT, Status INT, CreateTime INT, LastModifyTime INT, ClientId TEXT, VoiceLength INT, MsgLocalId INT, Human TEXT, reserved1 INT, reserved2 TEXT, MsgSource TEXT, MsgFlag INT, MsgSeq INT, MasterBufId INT, checksum INT DEFAULT 0, VoiceFlag INT DEFAULT 0, VoiceInfoExt BLOB , MsgTalker TEXT);

-- 字段说明:
--   FileName                       TEXT            (主键)
--   User                           TEXT            -- 业务聊天用户ID
--   MsgId                          INT             -- 消息ID (本地)
--   NetOffset                      INT            
--   FileNowSize                    INT            
--   TotalLen                       INT            
--   Status                         INT             -- 消息状态
--   CreateTime                     INT             -- 创建时间
--   LastModifyTime                 INT             -- 修改时间
--   ClientId                       TEXT            -- 自增ID
--   VoiceLength                    INT             -- 语音时长
--   MsgLocalId                     INT             -- 消息本地ID
--   Human                          TEXT           
--   reserved1                      INT             -- 保留字段1
--   reserved2                      TEXT            -- 保留字段2
--   MsgSource                      TEXT           
--   MsgFlag                        INT             -- 标记
--   MsgSeq                         INT             -- 消息序列号
--   MasterBufId                    INT             -- 自增ID
--   checksum                       INT            
--   VoiceFlag                      INT             -- 标记
--   VoiceInfoExt                   BLOB            -- 扩展
--   MsgTalker                      TEXT            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: w1w_img_info_table
-- 说明: 图片相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE w1w_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, msgTalker TEXT , originSourceMd5 TEXT);

-- 字段说明:
--   id                             INTEGER         -- 自增ID (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   offset                         INT            
--   totalLen                       INT            
--   bigImgPath                     TEXT            -- 大图路径
--   thumbImgPath                   TEXT            -- 图片路径
--   createtime                     INT             -- 创建时间
--   msglocalid                     INT             -- 消息本地ID
--   status                         INT             -- 消息状态
--   nettimes                       INT            
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   hashdthumb                     int            
--   iscomplete                     INT            
--   origImgMD5                     TEXT            -- MD5值
--   compressType                   INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   midImgPath                     TEXT            -- 中图路径
--   forwardType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   hevcPath                       TEXT            -- HEVC视频路径
--   sendImgType                    INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   msgTalker                      TEXT            -- 对话者ID (wxid或群ID)
--   originSourceMd5                TEXT            -- MD5值


-- ========================================================
-- 表名: w1wmessage
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE w1wmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB);

-- 字段说明:
--   msgId                          LONG            -- 消息ID (本地) (主键)
--   msgSvrId                       LONG            -- 消息服务器ID
--   type                           INTEGER         -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   status                         INTEGER         -- 消息状态
--   isSend                         INTEGER         -- 是否发送 (0=接收, 1=发送)
--   isShowTimer                    INTEGER         -- 是否显示时间
--   createTime                     LONG            -- 创建时间
--   talker                         TEXT            -- 对话者ID (wxid或群ID)
--   content                        TEXT            -- 消息内容
--   imgPath                        TEXT            -- 图片路径
--   reserved                       TEXT            -- 保留字段
--   lvbuffer                       BLOB            -- 二进制数据
--   talkerId                       INTEGER         -- 对话者数字ID
--   transContent                   TEXT            -- 翻译内容
--   transBrandWording              TEXT            -- 品牌翻译
--   bizClientMsgId                 TEXT            -- 业务客户端消息ID
--   bizChatId                      LONG            -- 业务聊天ID
--   bizChatUserId                  TEXT            -- 业务聊天用户ID
--   msgSeq                         LONG            -- 消息序列号
--   flag                           INTEGER         -- 标记
--   fromUsername                   TEXT            -- 用户名
--   toUsername                     TEXT            -- 用户名
--   extInfo                        BLOB            -- 来源扩展信息


-- ========================================================
-- 表名: walletcache
-- 说明: 支付/钱包相关表
-- ========================================================
-- 记录数: 17

CREATE TABLE walletcache ( sid TEXT PRIMARY KEY, type INT, value TEXT );

-- 字段说明:
--   sid                            TEXT            -- 朋友圈动态ID (主键)
--   type                           INT             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   value                          TEXT           


-- ========================================================
-- 表名: zhugemsgvideoinfo
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE zhugemsgvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text);

-- 字段说明:
--   filename                       text            (主键)
--   clientid                       text            -- 自增ID
--   msgsvrid                       int             -- 消息服务器ID
--   netoffset                      int            
--   filenowsize                    int            
--   totallen                       int            
--   thumbnetoffset                 int            
--   thumblen                       int             -- CDN缩略图大小
--   status                         int             -- 消息状态
--   createtime                     long            -- 创建时间
--   lastmodifytime                 long            -- 修改时间
--   downloadtime                   long           
--   videolength                    int             -- 长度/大小
--   msglocalid                     int             -- 消息本地ID
--   nettimes                       int            
--   cameratype                     int             -- 消息类型 (1=文本, 3=图片, 34=语音, 43=视频, 47=表情, 48=位置, 49=链接/文件, 10000=系统消息)
--   user                           text            -- 业务聊天用户ID
--   human                          text           
--   reserved1                      int             -- 保留字段1
--   reserved2                      int             -- 保留字段2
--   reserved3                      text            -- 保留字段3
--   reserved4                      text            -- 保留字段4
--   videofuncflag                  int             -- 标记
--   masssendid                     long            -- 自增ID
--   masssendlist                   text           
--   videomd5                       text            -- 自增ID
--   streamvideo                    byte[]          -- 自增ID
--   statextstr                     text            -- 扩展
--   downloadscene                  int            
--   mmsightextinfo                 byte[]          -- 扩展
--   preloadsize                    int            
--   videoformat                    int             -- 自增ID
--   forward_msg_local_id           int             -- 自增ID
--   msg_uuid                       text            -- 自增ID
--   share_app_info                 text           
--   origin_file_name               text           
--   had_clicked_video              int             -- 自增ID
--   media_id                       text            -- 自增ID
--   media_flag                     text            -- 标记
--   video_path                     text            -- 自增ID
--   media_cdnid                    text            -- 自增ID
--   video_wxa_info                 BLOB            -- 自增ID
--   weapp_source_username          text            -- 用户名
--   msg_talker                     text            -- 对话者ID (wxid或群ID)
--   forward_msg_talker             text            -- 对话者ID (wxid或群ID)


-- ========================================================
-- 表名: zhugemsgvideoinfoVideoHash
-- 说明: 消息相关表
-- ========================================================
-- 记录数: 0

CREATE TABLE zhugemsgvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text);

-- 字段说明:
--   size                           int            
--   CreateTime                     long            -- 创建时间
--   hash                           text           
--   cdnxml                         text            -- XML数据
--   orgpath                        text           

