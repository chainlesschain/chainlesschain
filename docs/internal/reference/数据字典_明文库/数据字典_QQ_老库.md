# 数据字典 — QQ 老库（`qq_old.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 48 张表 / 1144 个字段。

### `Ability` — (Ability)

```sql
CREATE TABLE Ability (_id INTEGER PRIMARY KEY AUTOINCREMENT,flags INTEGER,uin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `flags` | INTEGER | 标志s |
| `uin` | TEXT | QQ号/UIN |

### `Card` — 卡片表

```sql
CREATE TABLE Card (_id INTEGER PRIMARY KEY AUTOINCREMENT,addSrcId INTEGER,addSrcName TEXT,addSubSrcId INTEGER,age INTEGER,allowCalInteractive INTEGER,allowClick INTEGER,allowPeopleSee INTEGER,authState INTEGER,bAvailVoteCnt INTEGER,bBigClubVipOpen INTEGER,bCardInfo BLOB,bHaveVotedCnt INTEGER,bHollywoodVipOpen INTEGER,bQQVipOpen INTEGER,bSuperQQOpen INTEGER,bSuperVipOpen INTEGER,bVoted INTEGER,babyQSwitch INTEGER,backgroundColor INTEGER,backgroundUrl TEXT,bgType BLOB,bigVipBadgeItemId INTEGER,bindPhoneInfo TEXT,cardId INTEGER,cardType INTEGER,category INTEGER,clothesId INTEGER,constellation INTEGER,declaration TEXT,defaultCardId INTEGER,diyComplicatedInfo TEXT,diyDefaultText TEXT,diyText TEXT,diyTextDegree REAL,diyTextFontId INTEGER,diyTextHeight REAL,diyTextLocX REAL,diyTextLocY REAL,diyTextScale REAL,diyTextTransparency REAL,diyTextWidth REAL,dynamicCardFlag INTEGER,encId TEXT,enlargeQzonePic INTEGER,extendFriendEntryAddFriend INTEGER,extendFriendEntryContact INTEGER,extendFriendFlag INTEGER,extendFriendQuestion INTEGER,extendFriendVoiceDuration INTEGER,favoriteSource INTEGER,feedPreviewTime INTEGER,fontId INTEGER,fontType INTEGER,forbidCode INTEGER,gameCardId INTEGER,grayNameplateFlag INTEGER,greenLevel INTEGER,hasFakeData INTEGER,hobbyEntry TEXT,iBigClubVipLevel INTEGER,iBigClubVipType INTEGER,iHollywoodVipLevel INTEGER,iHollywoodVipType INTEGER,iMedalCount INTEGER,iNewCount INTEGER,iProfession INTEGER,iQQLevel INTEGER,iQQVipLevel INTEGER,iQQVipType INTEGER,iSuperQQLevel INTEGER,iSuperQQType INTEGER,iSuperVipLevel INTEGER,iSuperVipType INTEGER,iUpgradeCount INTEGER,iVoteIncrement INTEGER,iXManScene1DelayTime INTEGER,iXManScene2DelayTime INTEGER,idx INTEGER,isForbidAccount INTEGER,isGreenDiamond INTEGER,isHidePrettyGroutIdentity INTEGER,isPrettyGroupOwner INTEGER,isRedDiamond INTEGER,isShowCard INTEGER,isSuperGreenDiamond INTEGER,isSuperRedDiamond INTEGER,isSuperYellowDiamond INTEGER,isYellowDiamond INTEGER,isZPlanAvatar INTEGER,isZPlanProfileCardMiniHomeShow TEXT,isZplanMasterShow INTEGER,isZplanProfileCardShow INTEGER,lBigClubTemplateId INTEGER,lBirthday INTEGER,lCurrentBgId INTEGER,lCurrentStyleId INTEGER,lLoginDays INTEGER,lQQMasterLogindays INTEGER,lSignModifyTime INTEGER,lSuperVipTemplateId INTEGER,lUserFlag INTEGER,lVisitCount INTEGER,lVoteCount INTEGER,labelInfoBytes BLOB,lastPraiseInfoList BLOB,lhLevel INTEGER,mQQLevelType INTEGER,medalSwitchDisable INTEGER,nFaceID INTEGER,namePlateOfKingDan INTEGER,namePlateOfKingDanDisplatSwitch INTEGER,namePlateOfKingGameId INTEGER,namePlateOfKingLoginTime INTEGER,nameplateExtId INTEGER,nameplateVipType INTEGER,popularity INTEGER,presentCustourl TEXT,presentDesc TEXT,presentNum INTEGER,presentSwitch INTEGER,privilegeJumpUrl TEXT,privilegePromptStr TEXT,qid TEXT,qidBgUrl TEXT,qidColor TEXT,qidLogoUrl TEXT,redLevel INTEGER,schoolId TEXT,schoolName TEXT,schoolVerifiedFlag INTEGER,shGender INTEGER,showPresent INTEGER,showPublishButton INTEGER,strActiveUrl TEXT,strAutoRemark TEXT,strCity TEXT,strCompany TEXT,strContactName TEXT,strCountry TEXT,strCurrentBgUrl TEXT,strDrawerCardUrl TEXT,strEmail TEXT,strExtInfo TEXT,strHometownCity TEXT,strHometownCodes TEXT,strHometownCountry TEXT,strHometownDesc TEXT,strHometownProvince TEXT,strLocationCodes TEXT,strLocationDesc TEXT,strLoginDaysDesc TEXT,strMobile TEXT,strNick TEXT,strPersonalNote TEXT,strPromptParams TEXT,strProvince TEXT,strQzoneFeedsDesc TEXT,strQzoneHeader TEXT,strReMark TEXT,strSchool TEXT,strShowName TEXT,strSign TEXT,strSpaceName TEXT,strStatus TEXT,strVoteLimitedNotice TEXT,strWzryHeroUrl TEXT,strZipUrl TEXT,strZplanUrl TEXT,strangerInviteMeGroupOpen INTEGER,strangerVoteOpen INTEGER,tempChatSig BLOB,templateRet INTEGER,troopHonorSwitch INTEGER,uCurMulType INTEGER,uFaceTimeStamp INTEGER,uin TEXT UNIQUE,ulShowControl INTEGER,updateTime INTEGER,vClosePriv BLOB,vCookies BLOB,vCoverInfo BLOB,vLongNickTopicInfo BLOB,vOpenPriv BLOB,vQQFaceID BLOB,vQzoneCoverInfo BLOB,vQzonePhotos BLOB,vRichSign BLOB,vSeed BLOB,vipIcons TEXT,vipMedalId INTEGER,vipMedalJumpUrl TEXT,vipStarFlag INTEGER,voiceUrl TEXT,wzryHonorInfo BLOB,yellowLevel INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `addSrcId` | INTEGER | 广告dsrcID |
| `addSrcName` | TEXT | 广告dsrc名称 |
| `addSubSrcId` | INTEGER | 广告dsubsrcID |
| `age` | INTEGER | (age) |
| `allowCalInteractive` | INTEGER | allowcalinter活跃 |
| `allowClick` | INTEGER | allow点击 |
| `allowPeopleSee` | INTEGER | (allowPeopleSee) |
| `authState` | INTEGER | 授权状态 |
| `bAvailVoteCnt` | INTEGER | (bAvailVoteCnt) |
| `bBigClubVipOpen` | INTEGER | bbigclubVIPopen |
| `bCardInfo` | BLOB | b卡片信息 |
| `bHaveVotedCnt` | INTEGER | (bHaveVotedCnt) |
| `bHollywoodVipOpen` | INTEGER | bhollywoodVIPopen |
| `bQQVipOpen` | INTEGER | bqqVIPopen |
| `bSuperQQOpen` | INTEGER | (bSuperQQOpen) |
| `bSuperVipOpen` | INTEGER | bsuperVIPopen |
| `bVoted` | INTEGER | (bVoted) |
| `babyQSwitch` | INTEGER | (babyQSwitch) |
| `backgroundColor` | INTEGER | 背景颜色 |
| `backgroundUrl` | TEXT | 背景链接 |
| `bgType` | BLOB | 背景类型 |
| `bigVipBadgeItemId` | INTEGER | bigVIPb广告ge项ID |
| `bindPhoneInfo` | TEXT | bind手机信息 |
| `cardId` | INTEGER | 卡片ID |
| `cardType` | INTEGER | 卡片类型 |
| `category` | INTEGER | 分类 |
| `clothesId` | INTEGER | clothesID |
| `constellation` | INTEGER | constel纬度ion |
| `declaration` | TEXT | decla比例n |
| `defaultCardId` | INTEGER | 默认卡片ID |
| `diyComplicatedInfo` | TEXT | diycomplicated信息 |
| `diyDefaultText` | TEXT | diy默认文本 |
| `diyText` | TEXT | diy文本 |
| `diyTextDegree` | REAL | diy文本degree |
| `diyTextFontId` | INTEGER | diy文本字体ID |
| `diyTextHeight` | REAL | diy文本高 |
| `diyTextLocX` | REAL | diy文本locx |
| `diyTextLocY` | REAL | diy文本locy |
| `diyTextScale` | REAL | diy文本缩放 |
| `diyTextTransparency` | REAL | diy文本翻译parency |
| `diyTextWidth` | REAL | diy文本宽 |
| `dynamicCardFlag` | INTEGER | dynamic卡片标志 |
| `encId` | TEXT | encID |
| `enlargeQzonePic` | INTEGER | enlargeqzone图片 |
| `extendFriendEntryAddFriend` | INTEGER | 扩展结束好友入口广告d好友 |
| `extendFriendEntryContact` | INTEGER | 扩展结束好友入口联系人 |
| `extendFriendFlag` | INTEGER | 扩展结束好友标志 |
| `extendFriendQuestion` | INTEGER | 扩展结束好友question |
| `extendFriendVoiceDuration` | INTEGER | 扩展结束好友语音时长 |
| `favoriteSource` | INTEGER | 收藏来源 |
| `feedPreviewTime` | INTEGER | 信息流pre查看时间 |
| `fontId` | INTEGER | 字体ID |
| `fontType` | INTEGER | 字体类型 |
| `forbidCode` | INTEGER | forbID码 |
| `gameCardId` | INTEGER | 游戏卡片ID |
| `grayNameplateFlag` | INTEGER | gray名称p纬度e标志 |
| `greenLevel` | INTEGER | green级别 |
| `hasFakeData` | INTEGER | 是否fake数据 |
| `hobbyEntry` | TEXT | hobby入口 |
| `iBigClubVipLevel` | INTEGER | ibigclubVIP级别 |
| `iBigClubVipType` | INTEGER | ibigclubVIP类型 |
| `iHollywoodVipLevel` | INTEGER | ihollywoodVIP级别 |
| `iHollywoodVipType` | INTEGER | ihollywoodVIP类型 |
| `iMedalCount` | INTEGER | imedal数量 |
| `iNewCount` | INTEGER | inew数量 |
| `iProfession` | INTEGER | (iProfession) |
| `iQQLevel` | INTEGER | iqq级别 |
| `iQQVipLevel` | INTEGER | iqqVIP级别 |
| `iQQVipType` | INTEGER | iqqVIP类型 |
| `iSuperQQLevel` | INTEGER | 是否uperqq级别 |
| `iSuperQQType` | INTEGER | 是否uperqq类型 |
| `iSuperVipLevel` | INTEGER | 是否uperVIP级别 |
| `iSuperVipType` | INTEGER | 是否uperVIP类型 |
| `iUpgradeCount` | INTEGER | iup等级数量 |
| `iVoteIncrement` | INTEGER | (iVoteIncrement) |
| `iXManScene1DelayTime` | INTEGER | ixman场景1延迟时间 |
| `iXManScene2DelayTime` | INTEGER | ixman场景2延迟时间 |
| `idx` | INTEGER | 索引 |
| `isForbidAccount` | INTEGER | 是否forbID账号 |
| `isGreenDiamond` | INTEGER | 是否gre结束iamond |
| `isHidePrettyGroutIdentity` | INTEGER | 是否hIDeprettygroutIDentity |
| `isPrettyGroupOwner` | INTEGER | 是否pretty群/组群主/拥有者 |
| `isRedDiamond` | INTEGER | 是否红包diamond |
| `isShowCard` | INTEGER | 是否显示卡片 |
| `isSuperGreenDiamond` | INTEGER | 是否supergre结束iamond |
| `isSuperRedDiamond` | INTEGER | 是否super红包diamond |
| `isSuperYellowDiamond` | INTEGER | (isSuperYellowDiamond) |
| `isYellowDiamond` | INTEGER | (isYellowDiamond) |
| `isZPlanAvatar` | INTEGER | 是否zplan头像 |
| `isZPlanProfileCardMiniHomeShow` | TEXT | 是否zplan资料卡片最小ihome显示 |
| `isZplanMasterShow` | INTEGER | 是否zplanmaster显示 |
| `isZplanProfileCardShow` | INTEGER | 是否zplan资料卡片显示 |
| `lBigClubTemplateId` | INTEGER | lbigclub模板ID |
| `lBirthday` | INTEGER | (lBirthday) |
| `lCurrentBgId` | INTEGER | l当前背景ID |
| `lCurrentStyleId` | INTEGER | l当前样式ID |
| `lLoginDays` | INTEGER | l登录days |
| `lQQMasterLogindays` | INTEGER | lqqmaster登录days |
| `lSignModifyTime` | INTEGER | l签名修改时间 |
| `lSuperVipTemplateId` | INTEGER | lsuperVIP模板ID |
| `lUserFlag` | INTEGER | l用户标志 |
| `lVisitCount` | INTEGER | lvisit数量 |
| `lVoteCount` | INTEGER | lvote数量 |
| `labelInfoBytes` | BLOB | 标签信息字节 |
| `lastPraiseInfoList` | BLOB | 最后点赞信息列表 |
| `lhLevel` | INTEGER | lh级别 |
| `mQQLevelType` | INTEGER | mqq级别类型 |
| `medalSwitchDisable` | INTEGER | medalswitch禁用 |
| `nFaceID` | INTEGER | nfaceID |
| `namePlateOfKingDan` | INTEGER | 名称p纬度eofkingdan |
| `namePlateOfKingDanDisplatSwitch` | INTEGER | 名称p纬度eofkingdandisp纬度switch |
| `namePlateOfKingGameId` | INTEGER | 名称p纬度eofking游戏ID |
| `namePlateOfKingLoginTime` | INTEGER | 名称p纬度eofking登录时间 |
| `nameplateExtId` | INTEGER | 名称p纬度e扩展ID |
| `nameplateVipType` | INTEGER | 名称p纬度eVIP类型 |
| `popularity` | INTEGER | (popularity) |
| `presentCustourl` | TEXT | presentcusto链接 |
| `presentDesc` | TEXT | present描述 |
| `presentNum` | INTEGER | present数量 |
| `presentSwitch` | INTEGER | presen时间戳witch |
| `privilegeJumpUrl` | TEXT | privilegejump链接 |
| `privilegePromptStr` | TEXT | privilegepromp时间戳tr |
| `qid` | TEXT | qID |
| `qidBgUrl` | TEXT | qID背景链接 |
| `qidColor` | TEXT | qID颜色 |
| `qidLogoUrl` | TEXT | qID日志o链接 |
| `redLevel` | INTEGER | 红包级别 |
| `schoolId` | TEXT | schoolID |
| `schoolName` | TEXT | school名称 |
| `schoolVerifiedFlag` | INTEGER | schoolverified标志 |
| `shGender` | INTEGER | sh性别 |
| `showPresent` | INTEGER | 显示present |
| `showPublishButton` | INTEGER | 显示发布button |
| `strActiveUrl` | TEXT | str活跃链接 |
| `strAutoRemark` | TEXT | strauto备注 |
| `strCity` | TEXT | str城市 |
| `strCompany` | TEXT | (strCompany) |
| `strContactName` | TEXT | str联系人名称 |
| `strCountry` | TEXT | str国家 |
| `strCurrentBgUrl` | TEXT | str当前背景链接 |
| `strDrawerCardUrl` | TEXT | strd原始er卡片链接 |
| `strEmail` | TEXT | str邮箱 |
| `strExtInfo` | TEXT | str扩展信息 |
| `strHometownCity` | TEXT | strhometown城市 |
| `strHometownCodes` | TEXT | strhometown码s |
| `strHometownCountry` | TEXT | strhometown国家 |
| `strHometownDesc` | TEXT | strhometown描述 |
| `strHometownProvince` | TEXT | strhometown省 |
| `strLocationCodes` | TEXT | strlocation码s |
| `strLocationDesc` | TEXT | strlocation描述 |
| `strLoginDaysDesc` | TEXT | str登录days描述 |
| `strMobile` | TEXT | str手机 |
| `strNick` | TEXT | (strNick) |
| `strPersonalNote` | TEXT | (strPersonalNote) |
| `strPromptParams` | TEXT | strprompt参数 |
| `strProvince` | TEXT | str省 |
| `strQzoneFeedsDesc` | TEXT | strqzone信息流s描述 |
| `strQzoneHeader` | TEXT | strqzone头像er |
| `strReMark` | TEXT | str备注 |
| `strSchool` | TEXT | (strSchool) |
| `strShowName` | TEXT | str显示名称 |
| `strSign` | TEXT | str签名 |
| `strSpaceName` | TEXT | strspace名称 |
| `strStatus` | TEXT | str状态 |
| `strVoteLimitedNotice` | TEXT | strvote限制ed通知/公告 |
| `strWzryHeroUrl` | TEXT | strwzryhero链接 |
| `strZipUrl` | TEXT | strzip链接 |
| `strZplanUrl` | TEXT | strzplan链接 |
| `strangerInviteMeGroupOpen` | INTEGER | 陌生人邀请me群/组open |
| `strangerVoteOpen` | INTEGER | 陌生人voteopen |
| `tempChatSig` | BLOB | 临时聊天sig |
| `templateRet` | INTEGER | 模板ret |
| `troopHonorSwitch` | INTEGER | 群(QQ)honorswitch |
| `uCurMulType` | INTEGER | ucurmul类型 |
| `uFaceTimeStamp` | INTEGER | uface时间戳 |
| `uin` | TEXT | QQ号/UIN |
| `ulShowControl` | INTEGER | ul显示control |
| `updateTime` | INTEGER | 更新时间 |
| `vClosePriv` | BLOB | (vClosePriv) |
| `vCookies` | BLOB | vCookies |
| `vCoverInfo` | BLOB | v封面信息 |
| `vLongNickTopicInfo` | BLOB | vlongnick置顶ic信息 |
| `vOpenPriv` | BLOB | (vOpenPriv) |
| `vQQFaceID` | BLOB | vqqfaceID |
| `vQzoneCoverInfo` | BLOB | vqzone封面信息 |
| `vQzonePhotos` | BLOB | vqzone照片s |
| `vRichSign` | BLOB | vrich签名 |
| `vSeed` | BLOB | (vSeed) |
| `vipIcons` | TEXT | VIP图标s |
| `vipMedalId` | INTEGER | VIPmedalID |
| `vipMedalJumpUrl` | TEXT | VIPmedaljump链接 |
| `vipStarFlag` | INTEGER | VIPstar标志 |
| `voiceUrl` | TEXT | 语音链接 |
| `wzryHonorInfo` | BLOB | wzryhonor信息 |
| `yellowLevel` | INTEGER | yellow级别 |

### `ColorNote` — 颜色note表

```sql
CREATE TABLE ColorNote (_id INTEGER PRIMARY KEY AUTOINCREMENT,mExtLong INTEGER,mExtra INTEGER,mMainTitle TEXT,mPicUrl TEXT,mReserve BLOB,mServiceType INTEGER,mState INTEGER,mSubTitle TEXT,mSubType TEXT,mTime INTEGER,mUniKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `mExtLong` | INTEGER | m扩展long |
| `mExtra` | INTEGER | m扩展 |
| `mMainTitle` | TEXT | mmain标题 |
| `mPicUrl` | TEXT | m图片链接 |
| `mReserve` | BLOB | (mReserve) |
| `mServiceType` | INTEGER | m服务类型 |
| `mState` | INTEGER | m状态 |
| `mSubTitle` | TEXT | msub标题 |
| `mSubType` | TEXT | m子类型 |
| `mTime` | INTEGER | m时间 |
| `mUniKey` | TEXT | muni键 |

### `ContactCard` — 联系人卡片表

```sql
CREATE TABLE ContactCard (_id INTEGER PRIMARY KEY AUTOINCREMENT,bAge INTEGER,bSex INTEGER,bindQQ INTEGER,forbidCode INTEGER,isForbidAccount INTEGER,mobileCode TEXT,mobileNo TEXT UNIQUE,nationCode TEXT,nickName TEXT,strCity TEXT,strContactName TEXT,strCountry TEXT,strProvince TEXT,uin TEXT,vCoverInfo BLOB,vRichSign BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `bAge` | INTEGER | (bAge) |
| `bSex` | INTEGER | b性别 |
| `bindQQ` | INTEGER | (bindQQ) |
| `forbidCode` | INTEGER | forbID码 |
| `isForbidAccount` | INTEGER | 是否forbID账号 |
| `mobileCode` | TEXT | 手机码 |
| `mobileNo` | TEXT | 手机no |
| `nationCode` | TEXT | nation码 |
| `nickName` | TEXT | 昵称 |
| `strCity` | TEXT | str城市 |
| `strContactName` | TEXT | str联系人名称 |
| `strCountry` | TEXT | str国家 |
| `strProvince` | TEXT | str省 |
| `uin` | TEXT | QQ号/UIN |
| `vCoverInfo` | BLOB | v封面信息 |
| `vRichSign` | BLOB | vrich签名 |

### `DesktopAppEntityV3` — desk置顶应用entity表

```sql
CREATE TABLE DesktopAppEntityV3 (_id INTEGER PRIMARY KEY AUTOINCREMENT,appId TEXT,appInfo BLOB,name TEXT,uniqueId TEXT UNIQUE,verType INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `appId` | TEXT | 应用ID |
| `appInfo` | BLOB | 应用信息 |
| `name` | TEXT | 名称 |
| `uniqueId` | TEXT | uniqueID |
| `verType` | INTEGER | ver类型 |

### `DiscussionInfo` — 讨论组ion表

```sql
CREATE TABLE DiscussionInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,DiscussionFlag INTEGER,createFrom INTEGER,createTime INTEGER,discussionName TEXT,faceUinSet TEXT,groupCode INTEGER,groupUin INTEGER,hasCollect INTEGER,infoSeq INTEGER,inheritOwnerUin TEXT,mComparePartInt INTEGER,mCompareSpell TEXT,mOrigin INTEGER,mOriginExtra INTEGER,mSelfRight INTEGER,ownerUin TEXT,timeSec INTEGER,uiControlFlag INTEGER,uin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `DiscussionFlag` | INTEGER | 讨论组ion标志 |
| `createFrom` | INTEGER | 创建from |
| `createTime` | INTEGER | 创建时间 |
| `discussionName` | TEXT | 讨论组ion名称 |
| `faceUinSet` | TEXT | faceQQ号/UINset |
| `groupCode` | INTEGER | 群/组码 |
| `groupUin` | INTEGER | 群/组QQ号/UIN |
| `hasCollect` | INTEGER | 是否收藏 |
| `infoSeq` | INTEGER | 信息序号 |
| `inheritOwnerUin` | TEXT | inherit群主/拥有者QQ号/UIN |
| `mComparePartInt` | INTEGER | (mComparePartInt) |
| `mCompareSpell` | TEXT | (mCompareSpell) |
| `mOrigin` | INTEGER | m原始 |
| `mOriginExtra` | INTEGER | m原始扩展 |
| `mSelfRight` | INTEGER | m自己right |
| `ownerUin` | TEXT | 群主/拥有者QQ号/UIN |
| `timeSec` | INTEGER | 时间sec |
| `uiControlFlag` | INTEGER | u图标trol标志 |
| `uin` | TEXT | QQ号/UIN |

### `Emoticon` — 表情

```sql
CREATE TABLE Emoticon (_id INTEGER PRIMARY KEY AUTOINCREMENT,backColor TEXT,businessExtra TEXT,character TEXT,clickNum INTEGER,eId TEXT,encryptKey TEXT,epId TEXT,exposeNum INTEGER,extensionHeight INTEGER,extensionWidth INTEGER,height INTEGER,ipsiteName TEXT,ipsiteUrl TEXT,isAPNG INTEGER,isSound INTEGER,jobType INTEGER,keyword TEXT,keywords TEXT,magicValue TEXT,name TEXT,value INTEGER,voicePrint TEXT,volumeColor TEXT,width INTEGER,UNIQUE(eId,epId) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `backColor` | TEXT | back颜色 |
| `businessExtra` | TEXT | busines性别tra |
| `character` | TEXT | (character) |
| `clickNum` | INTEGER | 点击数量 |
| `eId` | TEXT | eID |
| `encryptKey` | TEXT | 加密键 |
| `epId` | TEXT | epID |
| `exposeNum` | INTEGER | expose数量 |
| `extensionHeight` | INTEGER | 扩展ension高 |
| `extensionWidth` | INTEGER | 扩展ension宽 |
| `height` | INTEGER | 高 |
| `ipsiteName` | TEXT | ipsite名称 |
| `ipsiteUrl` | TEXT | ipsite链接 |
| `isAPNG` | INTEGER | (isAPNG) |
| `isSound` | INTEGER | (isSound) |
| `jobType` | INTEGER | job类型 |
| `keyword` | TEXT | 键词 |
| `keywords` | TEXT | 键词s |
| `magicValue` | TEXT | 魔法值 |
| `name` | TEXT | 名称 |
| `value` | INTEGER | 值 |
| `voicePrint` | TEXT | 语音print |
| `volumeColor` | TEXT | volume颜色 |
| `width` | INTEGER | 宽 |

### `EmoticonPackage` — 表情包

```sql
CREATE TABLE EmoticonPackage (_id INTEGER PRIMARY KEY AUTOINCREMENT,aio INTEGER,author TEXT,beginTime INTEGER,businessExtra TEXT,buttonWording TEXT,childEpId TEXT,comeFom TEXT,copywritingContent TEXT,copywritingType INTEGER,diversionName TEXT,downloadCount INTEGER,endTime INTEGER,epId TEXT UNIQUE,expiretime INTEGER,extraFlags INTEGER,firstEmotionId TEXT,hasIpProduct INTEGER,hasReadUpdatePage INTEGER,hasSound INTEGER,imageUrl TEXT,ipDetail TEXT,ipJumpUrl TEXT,ipLastReqTime INTEGER,ipName TEXT,ipOpName TEXT,ipReqTime INTEGER,ipSiteInfoBytes BLOB,ipUrl TEXT,isAPNG INTEGER,isMagicFaceDownloading INTEGER,isRecommendation INTEGER,jobType INTEGER,jsonVersion INTEGER default 0,jumpUrl TEXT,kandian INTEGER,kinId TEXT,latestVersion INTEGER,localVersion INTEGER,mark TEXT,minQQVersion TEXT,mobileFeetype INTEGER,name TEXT,newSoundEp INTEGER,richIPLastReqTime INTEGER,richIPReqTime INTEGER,rscType INTEGER,status INTEGER,subType INTEGER,supportSize TEXT,type INTEGER,updateFlag INTEGER,updateTip TEXT,upperLeftLable INTEGER,valid INTEGER,wordingId INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `aio` | INTEGER | (aio) |
| `author` | TEXT | 授权or |
| `beginTime` | INTEGER | 开始时间 |
| `businessExtra` | TEXT | busines性别tra |
| `buttonWording` | TEXT | button文案 |
| `childEpId` | TEXT | 子epID |
| `comeFom` | TEXT | (comeFom) |
| `copywritingContent` | TEXT | copywriting内容 |
| `copywritingType` | INTEGER | copywriting类型 |
| `diversionName` | TEXT | di版本名称 |
| `downloadCount` | INTEGER | 下载数量 |
| `endTime` | INTEGER | 结束时间 |
| `epId` | TEXT | epID |
| `expiretime` | INTEGER | 过期时间 |
| `extraFlags` | INTEGER | 扩展标志s |
| `firstEmotionId` | TEXT | 首表情ID |
| `hasIpProduct` | INTEGER | 是否ip产品 |
| `hasReadUpdatePage` | INTEGER | 是否已读更新页 |
| `hasSound` | INTEGER | (hasSound) |
| `imageUrl` | TEXT | 图片链接 |
| `ipDetail` | TEXT | ip详情 |
| `ipJumpUrl` | TEXT | ipjump链接 |
| `ipLastReqTime` | INTEGER | ip最后req时间 |
| `ipName` | TEXT | ip名称 |
| `ipOpName` | TEXT | ipop名称 |
| `ipReqTime` | INTEGER | ipreq时间 |
| `ipSiteInfoBytes` | BLOB | ipsite信息字节 |
| `ipUrl` | TEXT | ip链接 |
| `isAPNG` | INTEGER | (isAPNG) |
| `isMagicFaceDownloading` | INTEGER | 是否魔法face下载ing |
| `isRecommendation` | INTEGER | 是否推荐ation |
| `jobType` | INTEGER | job类型 |
| `jsonVersion` | INTEGER | JSON版本 |
| `jumpUrl` | TEXT | jump链接 |
| `kandian` | INTEGER | (kandian) |
| `kinId` | TEXT | kinID |
| `latestVersion` | INTEGER | 纬度est版本 |
| `localVersion` | INTEGER | 本地版本 |
| `mark` | TEXT | 标记 |
| `minQQVersion` | TEXT | 最小qq版本 |
| `mobileFeetype` | INTEGER | 手机费用类型 |
| `name` | TEXT | 名称 |
| `newSoundEp` | INTEGER | 资讯oundep |
| `richIPLastReqTime` | INTEGER | richip最后req时间 |
| `richIPReqTime` | INTEGER | richipreq时间 |
| `rscType` | INTEGER | rsc类型 |
| `status` | INTEGER | 状态 |
| `subType` | INTEGER | 子类型 |
| `supportSize` | TEXT | suppor时间戳ize |
| `type` | INTEGER | 类型 |
| `updateFlag` | INTEGER | 更新标志 |
| `updateTip` | TEXT | 更新提示 |
| `upperLeftLable` | INTEGER | (upperLeftLable) |
| `valid` | INTEGER | 有效 |
| `wordingId` | INTEGER | 文案ID |

### `EmoticonTab` — 表情tab表

```sql
CREATE TABLE EmoticonTab (_id INTEGER PRIMARY KEY AUTOINCREMENT,aioHave INTEGER,epId TEXT UNIQUE,kandianHave INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `aioHave` | INTEGER | (aioHave) |
| `epId` | TEXT | epID |
| `kandianHave` | INTEGER | (kandianHave) |

### `EqqConfig` — eqq配置表

```sql
CREATE TABLE EqqConfig (_id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `data` | TEXT | 数据 |

### `ExpiredPushBanner` — 过期d推送横幅表

```sql
CREATE TABLE ExpiredPushBanner (_id INTEGER PRIMARY KEY AUTOINCREMENT ,cid INTEGER UNIQUE ,md5 TEXT ,endtime INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `cid` | INTEGER | cID |
| `md5` | TEXT | MD5 |
| `endtime` | INTEGER | 结束时间 |

### `FrontBackData` — frontback数据表

```sql
CREATE TABLE FrontBackData (_id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER,type INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `time` | INTEGER | 时间 |
| `type` | INTEGER | 类型 |

### `HotChatInfo` — hot聊天表

```sql
CREATE TABLE HotChatInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT ,name TEXT ,troopCode TEXT ,signature TEXT ,troopUin TEXT UNIQUE ,faceId INTEGER ,memberCount INTEGER ,hasJoined INTEGER ,isWifiHotChat INTEGER ,uuid TEXT ,iconUrl TEXT ,hotThemeGroupFlag INTEGER ,detail TEXT ,state INTEGER ,leftTime INTEGER ,ruState INTEGER ,supportFlashPic INTEGER ,supportDemo INTEGER ,adminLevel INTEGER ,joinUrl TEXT ,hotChatType INTEGER ,memo TEXT ,memoUrl TEXT ,memoShowed INTEGER ,userCreate INTEGER ,strAdminUins TEXT ,ownerUin TEXT ,pkFlag INTEGER ,subType INTEGER ,lLastMsgSeq INTEGER ,extra1 TEXT ,isFavorite INTEGER ,mFissionRoomNum INTEGER ,praiseCount INTEGER ,uint32_group_flag_ext2 INTEGER ,isGameRoom INTEGER ,isRobotHotChat INTEGER ,robotUin INTEGER ,apolloGameId INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `name` | TEXT | 名称 |
| `troopCode` | TEXT | 群(QQ)码 |
| `signature` | TEXT | 签名 |
| `troopUin` | TEXT | 群(QQ)QQ号/UIN |
| `faceId` | INTEGER | faceID |
| `memberCount` | INTEGER | 群成员数 |
| `hasJoined` | INTEGER | 是否加入ed |
| `isWifiHotChat` | INTEGER | 是否WiFihot聊天 |
| `uuid` | TEXT | UUID |
| `iconUrl` | TEXT | 图标链接 |
| `hotThemeGroupFlag` | INTEGER | hot主题群/组标志 |
| `detail` | TEXT | 详情 |
| `state` | INTEGER | 状态 |
| `leftTime` | INTEGER | left时间 |
| `ruState` | INTEGER | ru状态 |
| `supportFlashPic` | INTEGER | supportflash图片 |
| `supportDemo` | INTEGER | (supportDemo) |
| `adminLevel` | INTEGER | 广告最小级别 |
| `joinUrl` | TEXT | 加入链接 |
| `hotChatType` | INTEGER | hot聊天类型 |
| `memo` | TEXT | (memo) |
| `memoUrl` | TEXT | memo链接 |
| `memoShowed` | INTEGER | memo显示ed |
| `userCreate` | INTEGER | 用户创建 |
| `strAdminUins` | TEXT | str广告最小QQ号/UINs |
| `ownerUin` | TEXT | 群主/拥有者QQ号/UIN |
| `pkFlag` | INTEGER | pk标志 |
| `subType` | INTEGER | 子类型 |
| `lLastMsgSeq` | INTEGER | l最后消息序号 |
| `extra1` | TEXT | 扩展1 |
| `isFavorite` | INTEGER | 是否收藏 |
| `mFissionRoomNum` | INTEGER | mfission群数量 |
| `praiseCount` | INTEGER | 点赞数量 |
| `uint32_group_flag_ext2` | INTEGER | QQ号/UINt32群/组标志扩展2 |
| `isGameRoom` | INTEGER | 是否游戏群 |
| `isRobotHotChat` | INTEGER | 是否机器人hot聊天 |
| `robotUin` | INTEGER | 机器人QQ号/UIN |
| `apolloGameId` | INTEGER | a轮询o游戏ID |

### `LebaPluginConfig` — leba插件配置表

```sql
CREATE TABLE LebaPluginConfig (_id INTEGER PRIMARY KEY AUTOINCREMENT,allowChange TEXT,groupId INTEGER,priority INTEGER,resConf TEXT,sResSubType INTEGER,show INTEGER,showVer INTEGER,strGotoUrl TEXT,strGridIconUrl TEXT,strResName TEXT,strResURL TEXT,strSimpleResUrl TEXT,style TEXT,uiResId INTEGER UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `allowChange` | TEXT | (allowChange) |
| `groupId` | INTEGER | 群ID |
| `priority` | INTEGER | 优先级 |
| `resConf` | TEXT | (resConf) |
| `sResSubType` | INTEGER | sres子类型 |
| `show` | INTEGER | 显示 |
| `showVer` | INTEGER | 显示ver |
| `strGotoUrl` | TEXT | strgoto链接 |
| `strGridIconUrl` | TEXT | strg请求ID图标链接 |
| `strResName` | TEXT | strres名称 |
| `strResURL` | TEXT | strres链接 |
| `strSimpleResUrl` | TEXT | strsimpleres链接 |
| `style` | TEXT | 样式 |
| `uiResId` | INTEGER | uiresID |

### `MayKnowRecommend` — 可能认识的人推荐

```sql
CREATE TABLE MayKnowRecommend (_id INTEGER PRIMARY KEY AUTOINCREMENT,accountType INTEGER,addFriendSubSource INTEGER,addFriendsource INTEGER,additive BLOB,age INTEGER,algBuffer BLOB,busiInfoListByte BLOB,cardDisplayTimestamp INTEGER,category TEXT,city TEXT,country TEXT,dataSource INTEGER,friendStatus INTEGER,gender INTEGER,hasQZoneUpdate INTEGER,isVerify INTEGER,mediaInfosPacked TEXT,mobile_name TEXT,msgLabelByte BLOB,multiReason TEXT,nick TEXT,province TEXT,qZoneFeedsCnt INTEGER,qZoneJumpUrl TEXT,recommendReason TEXT,remark TEXT,richBuffer TEXT,richSingature BLOB,sourceId INTEGER,strToken TEXT,tabID INTEGER,timestamp INTEGER,traceId TEXT,transInfo TEXT,uin TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `accountType` | INTEGER | 账号类型 |
| `addFriendSubSource` | INTEGER | 广告d好友sub来源 |
| `addFriendsource` | INTEGER | 广告d好友来源 |
| `additive` | BLOB | 广告ditive |
| `age` | INTEGER | (age) |
| `algBuffer` | BLOB | alg缓冲 |
| `busiInfoListByte` | BLOB | busi信息列表字节 |
| `cardDisplayTimestamp` | INTEGER | 卡片显示时间戳 |
| `category` | TEXT | 分类 |
| `city` | TEXT | 城市 |
| `country` | TEXT | 国家 |
| `dataSource` | INTEGER | 数据来源 |
| `friendStatus` | INTEGER | 好友状态 |
| `gender` | INTEGER | 性别 |
| `hasQZoneUpdate` | INTEGER | 是否qzone更新 |
| `isVerify` | INTEGER | 是否验证 |
| `mediaInfosPacked` | TEXT | 媒体信息spacked |
| `mobile_name` | TEXT | 手机名称 |
| `msgLabelByte` | BLOB | 消息标签字节 |
| `multiReason` | TEXT | 多原因 |
| `nick` | TEXT | (nick) |
| `province` | TEXT | 省 |
| `qZoneFeedsCnt` | INTEGER | qzone信息流scnt |
| `qZoneJumpUrl` | TEXT | qzonejump链接 |
| `recommendReason` | TEXT | 推荐原因 |
| `remark` | TEXT | 备注 |
| `richBuffer` | TEXT | rich缓冲 |
| `richSingature` | BLOB | (richSingature) |
| `sourceId` | INTEGER | 来源ID |
| `strToken` | TEXT | str令牌 |
| `tabID` | INTEGER | tabID |
| `timestamp` | INTEGER | 时间戳 |
| `traceId` | TEXT | 追踪ID |
| `transInfo` | TEXT | 翻译信息 |
| `uin` | TEXT | QQ号/UIN |

### `MedalInfo` — (MedalInfo)

```sql
CREATE TABLE MedalInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,iId INTEGER UNIQUE,iLevel INTEGER,iLevelCount INTEGER,iNoProgress INTEGER,iPointLevel1 INTEGER,iPointLevel2 INTEGER,iPointLevel3 INTEGER,iType INTEGER,iUnreadLevel1 INTEGER,iUnreadLevel2 INTEGER,iUnreadLevel3 INTEGER,lEndTime INTEGER,lObtainTimeLevel1 INTEGER,lObtainTimeLevel2 INTEGER,lObtainTimeLevel3 INTEGER,lSeqLevel1 INTEGER,lSeqLevel2 INTEGER,lSeqLevel3 INTEGER,strDescLevel1 TEXT,strDescLevel2 TEXT,strDescLevel3 TEXT,strDetailUrlLevel1 TEXT,strDetailUrlLevel2 TEXT,strDetailUrlLevel3 TEXT,strName TEXT,strResJson TEXT,strTaskDescLevel1 TEXT,strTaskDescLevel2 TEXT,strTaskDescLevel3 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `iId` | INTEGER | iID |
| `iLevel` | INTEGER | i级别 |
| `iLevelCount` | INTEGER | i级别数量 |
| `iNoProgress` | INTEGER | (iNoProgress) |
| `iPointLevel1` | INTEGER | i积分级别1 |
| `iPointLevel2` | INTEGER | i积分级别2 |
| `iPointLevel3` | INTEGER | i积分级别3 |
| `iType` | INTEGER | i类型 |
| `iUnreadLevel1` | INTEGER | i未读级别1 |
| `iUnreadLevel2` | INTEGER | i未读级别2 |
| `iUnreadLevel3` | INTEGER | i未读级别3 |
| `lEndTime` | INTEGER | l结束时间 |
| `lObtainTimeLevel1` | INTEGER | lobtain时间级别1 |
| `lObtainTimeLevel2` | INTEGER | lobtain时间级别2 |
| `lObtainTimeLevel3` | INTEGER | lobtain时间级别3 |
| `lSeqLevel1` | INTEGER | l序号级别1 |
| `lSeqLevel2` | INTEGER | l序号级别2 |
| `lSeqLevel3` | INTEGER | l序号级别3 |
| `strDescLevel1` | TEXT | str描述级别1 |
| `strDescLevel2` | TEXT | str描述级别2 |
| `strDescLevel3` | TEXT | str描述级别3 |
| `strDetailUrlLevel1` | TEXT | str详情链接级别1 |
| `strDetailUrlLevel2` | TEXT | str详情链接级别2 |
| `strDetailUrlLevel3` | TEXT | str详情链接级别3 |
| `strName` | TEXT | str名称 |
| `strResJson` | TEXT | strresJSON |
| `strTaskDescLevel1` | TEXT | strtask描述级别1 |
| `strTaskDescLevel2` | TEXT | strtask描述级别2 |
| `strTaskDescLevel3` | TEXT | strtask描述级别3 |

### `MemberGradeLevelInfo` — 成员等级级别表

```sql
CREATE TABLE MemberGradeLevelInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,gameCardId INTEGER,gameCardSwitch INTEGER,gradeLevel INTEGER,memberuin TEXT UNIQUE,UNIQUE(memberuin) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `gameCardId` | INTEGER | 游戏卡片ID |
| `gameCardSwitch` | INTEGER | 游戏卡片switch |
| `gradeLevel` | INTEGER | 等级级别 |
| `memberuin` | TEXT | 成员QQ号/UIN |

### `NTIntimateBaseEntity` — (NTIntimateBaseEntity)

```sql
CREATE TABLE NTIntimateBaseEntity (_id INTEGER PRIMARY KEY AUTOINCREMENT,iconFlag BLOB,intimateChatDays INTEGER,intimateLevel INTEGER,intimateType INTEGER,isExtinguish INTEGER,isListenTogetherOpen INTEGER,lastIntimatChatTime INTEGER,mutualMarkStoreJson TEXT,uid TEXT,uin TEXT,UNIQUE(uid) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `iconFlag` | BLOB | 图标标志 |
| `intimateChatDays` | INTEGER | intimate聊天days |
| `intimateLevel` | INTEGER | intimate级别 |
| `intimateType` | INTEGER | intimate类型 |
| `isExtinguish` | INTEGER | 是否扩展inguish |
| `isListenTogetherOpen` | INTEGER | 是否列表entogetheropen |
| `lastIntimatChatTime` | INTEGER | 最后intimat聊天时间 |
| `mutualMarkStoreJson` | TEXT | mutual标记商店JSON |
| `uid` | TEXT | uid |
| `uin` | TEXT | QQ号/UIN |

### `NearbyPeopleCard` — 附近people卡片表

```sql
CREATE TABLE NearbyPeopleCard (_id INTEGER PRIMARY KEY AUTOINCREMENT ,tinyId INTEGER ,uin TEXT ,nowId INTEGER ,nowUserType INTEGER ,strRemark TEXT ,nickname TEXT ,gender INTEGER ,age INTEGER ,birthday INTEGER ,sign TEXT ,constellation INTEGER ,distance TEXT ,timeDiff TEXT ,aioDistanceAndTime TEXT ,likeCount INTEGER ,likeCountInc INTEGER ,oldPhotoCount INTEGER ,dateInfo BLOB ,ulShowControl INTEGER ,xuanYan BLOB ,maritalStatus INTEGER ,job INTEGER ,company TEXT ,college TEXT ,hometownCountry TEXT ,hometownProvice TEXT ,hometownCity TEXT ,hometownDistrict TEXT ,vCookies BLOB ,bVoted INTEGER ,feedPreviewTime INTEGER ,qzoneFeed TEXT ,qzoneName TEXT ,qzonePicUrl_1 TEXT ,qzonePicUrl_2 TEXT ,qzonePicUrl_3 TEXT ,isPhotoUseCache INTEGER ,vSeed BLOB ,vTempChatSig BLOB ,vGroupList BLOB ,nearbyInfo BLOB ,vActivityList BLOB ,lUserFlag INTEGER ,iIsGodFlag INTEGER ,strGodJumpUrl TEXT ,mHeartNum INTEGER ,switchQzone INTEGER ,switchHobby INTEGER ,uiShowControl INTEGER ,userFlag INTEGER ,busiEntry TEXT ,godFlag INTEGER ,nLastGameFlag INTEGER ,strProfileUrl TEXT ,lastUpdateNickTime INTEGER ,favoriteSource INTEGER ,switchGiftVisible INTEGER ,vGiftInfo BLOB ,sayHelloFlag INTEGER ,charm INTEGER ,charmLevel INTEGER ,nextThreshold INTEGER ,curThreshold INTEGER ,profPercent INTEGER ,taskFinished INTEGER ,taskTotal INTEGER ,hiWanInfo TEXT ,commonLabelString TEXT ,tagFlag INTEGER ,tagInfo TEXT ,picInfo TEXT ,videoDetails TEXT ,strFreshNewsInfo TEXT ,strHotChatInfo TEXT ,uRoomid INTEGER ,strVoteLimitedNotice TEXT ,bHaveVotedCnt INTEGER ,bAvailVoteCnt INTEGER ,collegeId INTEGER ,videoHeadFlag INTEGER ,bVideoHeadUrl TEXT ,faceScoreWordingColor INTEGER ,faceScoreWording TEXT ,faceScoreTailWordingColor INTEGER ,faceScoreTailWording TEXT ,faceScoreIconUrl TEXT ,entryAbility INTEGER ,strLevelType TEXT ,maskMsgFlag INTEGER ,isForbidSendMsg INTEGER ,isForbidSendGiftMsg INTEGER ,disableSendMsgBtnTips TEXT ,disableSendGiftBtnTips TEXT ,isForbidSendMsgForTribar INTEGER ,isForbidSendGiftMsgForTribar INTEGER ,disableSendMsgBtnTipsForTribar TEXT ,disableSendGiftBtnTipsForTribar TEXT ,highScoreNum INTEGER ,mHasStory INTEGER ,mQQStoryData BLOB ,isSendMsgBtnDownloadAppOpen INTEGER ,sendMsgBtnDownloadAppTips TEXT ,addPicBtnDownloadAppTips TEXT ,tribeAppDownloadPageUrl TEXT ,nearbyNowDataBytes BLOB ,guideAppNowTip TEXT ,guideAppNowTipLeftBtn TEXT ,guideAppNowTipRightBtnInstalled TEXT ,guideAppNowTipRightBtnNotInstalled TEXT ,guideAppNowPackage TEXT ,guideAppNowJumpUri TEXT ,guideAppNowDownloadUrl TEXT ,guideVerifiedDialogTitle TEXT ,guideVerifiedDialogRightBtnText TEXT ,firstOfficialMsg TEXT ,unverifyGrayTips TEXT ,isVerified INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `tinyId` | INTEGER | tinyID |
| `uin` | TEXT | QQ号/UIN |
| `nowId` | INTEGER | nowID |
| `nowUserType` | INTEGER | now用户类型 |
| `strRemark` | TEXT | str备注 |
| `nickname` | TEXT | 昵称 |
| `gender` | INTEGER | 性别 |
| `age` | INTEGER | (age) |
| `birthday` | INTEGER | (birthday) |
| `sign` | TEXT | 签名 |
| `constellation` | INTEGER | constel纬度ion |
| `distance` | TEXT | (distance) |
| `timeDiff` | TEXT | 时间diff |
| `aioDistanceAndTime` | TEXT | aiodistanceand时间 |
| `likeCount` | INTEGER | 点赞数量 |
| `likeCountInc` | INTEGER | 点赞数量inc |
| `oldPhotoCount` | INTEGER | old照片数量 |
| `dateInfo` | BLOB | 日期信息 |
| `ulShowControl` | INTEGER | ul显示control |
| `xuanYan` | BLOB | (xuanYan) |
| `maritalStatus` | INTEGER | marital状态 |
| `job` | INTEGER | (job) |
| `company` | TEXT | (company) |
| `college` | TEXT | (college) |
| `hometownCountry` | TEXT | hometown国家 |
| `hometownProvice` | TEXT | (hometownProvice) |
| `hometownCity` | TEXT | hometown城市 |
| `hometownDistrict` | TEXT | (hometownDistrict) |
| `vCookies` | BLOB | vCookies |
| `bVoted` | INTEGER | (bVoted) |
| `feedPreviewTime` | INTEGER | 信息流pre查看时间 |
| `qzoneFeed` | TEXT | qzone信息流 |
| `qzoneName` | TEXT | qzone名称 |
| `qzonePicUrl_1` | TEXT | qzone图片链接1 |
| `qzonePicUrl_2` | TEXT | qzone图片链接2 |
| `qzonePicUrl_3` | TEXT | qzone图片链接3 |
| `isPhotoUseCache` | INTEGER | 是否照片使用缓存 |
| `vSeed` | BLOB | (vSeed) |
| `vTempChatSig` | BLOB | v临时聊天sig |
| `vGroupList` | BLOB | v群/组列表 |
| `nearbyInfo` | BLOB | 附近信息 |
| `vActivityList` | BLOB | vactivity列表 |
| `lUserFlag` | INTEGER | l用户标志 |
| `iIsGodFlag` | INTEGER | iisgod标志 |
| `strGodJumpUrl` | TEXT | strgodjump链接 |
| `mHeartNum` | INTEGER | mheart数量 |
| `switchQzone` | INTEGER | (switchQzone) |
| `switchHobby` | INTEGER | (switchHobby) |
| `uiShowControl` | INTEGER | ui显示control |
| `userFlag` | INTEGER | 用户标志 |
| `busiEntry` | TEXT | busi入口 |
| `godFlag` | INTEGER | god标志 |
| `nLastGameFlag` | INTEGER | n最后游戏标志 |
| `strProfileUrl` | TEXT | str资料链接 |
| `lastUpdateNickTime` | INTEGER | 最后更新nick时间 |
| `favoriteSource` | INTEGER | 收藏来源 |
| `switchGiftVisible` | INTEGER | switch礼物visible |
| `vGiftInfo` | BLOB | v礼物信息 |
| `sayHelloFlag` | INTEGER | sayhello标志 |
| `charm` | INTEGER | (charm) |
| `charmLevel` | INTEGER | charm级别 |
| `nextThreshold` | INTEGER | n扩展threshold |
| `curThreshold` | INTEGER | (curThreshold) |
| `profPercent` | INTEGER | prof百分比 |
| `taskFinished` | INTEGER | task完成ed |
| `taskTotal` | INTEGER | task总 |
| `hiWanInfo` | TEXT | hiwan信息 |
| `commonLabelString` | TEXT | common标签string |
| `tagFlag` | INTEGER | 标签标志 |
| `tagInfo` | TEXT | 标签信息 |
| `picInfo` | TEXT | 图片信息 |
| `videoDetails` | TEXT | 视频详情s |
| `strFreshNewsInfo` | TEXT | strfresh资讯信息 |
| `strHotChatInfo` | TEXT | strhot聊天信息 |
| `uRoomid` | INTEGER | u房间ID |
| `strVoteLimitedNotice` | TEXT | strvote限制ed通知/公告 |
| `bHaveVotedCnt` | INTEGER | (bHaveVotedCnt) |
| `bAvailVoteCnt` | INTEGER | (bAvailVoteCnt) |
| `collegeId` | INTEGER | collegeID |
| `videoHeadFlag` | INTEGER | 视频头像标志 |
| `bVideoHeadUrl` | TEXT | b视频头像链接 |
| `faceScoreWordingColor` | INTEGER | face分数文案颜色 |
| `faceScoreWording` | TEXT | face分数文案 |
| `faceScoreTailWordingColor` | INTEGER | face分数tail文案颜色 |
| `faceScoreTailWording` | TEXT | face分数tail文案 |
| `faceScoreIconUrl` | TEXT | face分数图标链接 |
| `entryAbility` | INTEGER | 入口ability |
| `strLevelType` | TEXT | str级别类型 |
| `maskMsgFlag` | INTEGER | mask消息标志 |
| `isForbidSendMsg` | INTEGER | 是否forbID发送消息 |
| `isForbidSendGiftMsg` | INTEGER | 是否forbID发送礼物消息 |
| `disableSendMsgBtnTips` | TEXT | 禁用发送消息btn提示 |
| `disableSendGiftBtnTips` | TEXT | 禁用发送礼物btn提示 |
| `isForbidSendMsgForTribar` | INTEGER | 是否forbID发送消息fortribar |
| `isForbidSendGiftMsgForTribar` | INTEGER | 是否forbID发送礼物消息fortribar |
| `disableSendMsgBtnTipsForTribar` | TEXT | 禁用发送消息btn提示fortribar |
| `disableSendGiftBtnTipsForTribar` | TEXT | 禁用发送礼物btn提示fortribar |
| `highScoreNum` | INTEGER | high分数数量 |
| `mHasStory` | INTEGER | (mHasStory) |
| `mQQStoryData` | BLOB | mqqstory数据 |
| `isSendMsgBtnDownloadAppOpen` | INTEGER | 是否发送消息btn下载应用open |
| `sendMsgBtnDownloadAppTips` | TEXT | 发送消息btn下载应用提示 |
| `addPicBtnDownloadAppTips` | TEXT | 广告d图片btn下载应用提示 |
| `tribeAppDownloadPageUrl` | TEXT | tribe应用下载页链接 |
| `nearbyNowDataBytes` | BLOB | 附近now数据字节 |
| `guideAppNowTip` | TEXT | guide应用now提示 |
| `guideAppNowTipLeftBtn` | TEXT | guide应用now提示leftbtn |
| `guideAppNowTipRightBtnInstalled` | TEXT | guide应用now提示rightbtninstalled |
| `guideAppNowTipRightBtnNotInstalled` | TEXT | guide应用now提示rightbtnnotinstalled |
| `guideAppNowPackage` | TEXT | guide应用now包 |
| `guideAppNowJumpUri` | TEXT | guide应用nowjump地址 |
| `guideAppNowDownloadUrl` | TEXT | guide应用now下载链接 |
| `guideVerifiedDialogTitle` | TEXT | guideverified对话框标题 |
| `guideVerifiedDialogRightBtnText` | TEXT | guideverified对话框rightbtn文本 |
| `firstOfficialMsg` | TEXT | 首官方消息 |
| `unverifyGrayTips` | TEXT | un验证gray提示 |
| `isVerified` | INTEGER | (isVerified) |

### `PYMKBizEntryInfo` — pymKBiz入口表

```sql
CREATE TABLE PYMKBizEntryInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,backgroundDarkUrl TEXT,backgroundLightUrl TEXT,buttonJumpUrl TEXT,buttonText TEXT,cardJumpUrl TEXT,closeDelayTime INTEGER,dataSource INTEGER,horiBarIconDarkUrl TEXT,horiBarIconLightUrl TEXT,horiBarTitle TEXT,iconDarkUrl TEXT,iconLightUrl TEXT,lastCartonShowTime INTEGER,lastCloseTime INTEGER,orderNum INTEGER,subTitle TEXT,title TEXT,type INTEGER,UNIQUE(dataSource,type) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `backgroundDarkUrl` | TEXT | 背景dark链接 |
| `backgroundLightUrl` | TEXT | 背景light链接 |
| `buttonJumpUrl` | TEXT | buttonjump链接 |
| `buttonText` | TEXT | button文本 |
| `cardJumpUrl` | TEXT | 卡片jump链接 |
| `closeDelayTime` | INTEGER | close延迟时间 |
| `dataSource` | INTEGER | 数据来源 |
| `horiBarIconDarkUrl` | TEXT | horibar图标dark链接 |
| `horiBarIconLightUrl` | TEXT | horibar图标light链接 |
| `horiBarTitle` | TEXT | horibar标题 |
| `iconDarkUrl` | TEXT | 图标dark链接 |
| `iconLightUrl` | TEXT | 图标light链接 |
| `lastCartonShowTime` | INTEGER | 最后购物车on显示时间 |
| `lastCloseTime` | INTEGER | 最后close时间 |
| `orderNum` | INTEGER | 顺序数量 |
| `subTitle` | TEXT | sub标题 |
| `title` | TEXT | 标题 |
| `type` | INTEGER | 类型 |

### `PhoneContact` — 手机联系人表

```sql
CREATE TABLE PhoneContact (_id INTEGER PRIMARY KEY AUTOINCREMENT,ability INTEGER,abilityBits INTEGER,age INTEGER,bindingDate INTEGER,contactID INTEGER,detalStatusFlag INTEGER,eNetworkType INTEGER,faceUrl TEXT,hasSendAddReq INTEGER,highLightTimeStamp INTEGER,iTermType INTEGER,isHiden INTEGER,isNewRecommend INTEGER,isRecommend INTEGER,isUploaded INTEGER,label TEXT,lastScanTime INTEGER,md5 TEXT,mobileCode TEXT,mobileNo TEXT UNIQUE,name TEXT,nationCode TEXT,netTypeIconId INTEGER,netTypeIconIdIphoneOrWphoneNoWifi INTEGER,nickName TEXT,originBinder INTEGER,pinyinAll TEXT,pinyinInitial TEXT,remark TEXT,richBuffer BLOB,richTime INTEGER,samFriend INTEGER,sex INTEGER,sortWeight INTEGER,strTermDesc TEXT,type INTEGER,uin TEXT,unifiedCode TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `ability` | INTEGER | (ability) |
| `abilityBits` | INTEGER | ability位s |
| `age` | INTEGER | (age) |
| `bindingDate` | INTEGER | binding日期 |
| `contactID` | INTEGER | 联系人ID |
| `detalStatusFlag` | INTEGER | detal状态标志 |
| `eNetworkType` | INTEGER | e网络类型 |
| `faceUrl` | TEXT | face链接 |
| `hasSendAddReq` | INTEGER | 是否发送广告dreq |
| `highLightTimeStamp` | INTEGER | highlight时间戳 |
| `iTermType` | INTEGER | i词条类型 |
| `isHiden` | INTEGER | 是否hIDen |
| `isNewRecommend` | INTEGER | 是否new推荐 |
| `isRecommend` | INTEGER | 是否推荐 |
| `isUploaded` | INTEGER | 是否上传ed |
| `label` | TEXT | 标签 |
| `lastScanTime` | INTEGER | 最后扫描时间 |
| `md5` | TEXT | MD5 |
| `mobileCode` | TEXT | 手机码 |
| `mobileNo` | TEXT | 手机no |
| `name` | TEXT | 名称 |
| `nationCode` | TEXT | nation码 |
| `netTypeIconId` | INTEGER | net类型图标ID |
| `netTypeIconIdIphoneOrWphoneNoWifi` | INTEGER | net类型图标IDi手机orw手机noWiFi |
| `nickName` | TEXT | 昵称 |
| `originBinder` | INTEGER | 原始binder |
| `pinyinAll` | TEXT | 置顶yinall |
| `pinyinInitial` | TEXT | 置顶yininitial |
| `remark` | TEXT | 备注 |
| `richBuffer` | BLOB | rich缓冲 |
| `richTime` | INTEGER | rich时间 |
| `samFriend` | INTEGER | sam好友 |
| `sex` | INTEGER | 性别 |
| `sortWeight` | INTEGER | sort权重 |
| `strTermDesc` | TEXT | str词条描述 |
| `type` | INTEGER | 类型 |
| `uin` | TEXT | QQ号/UIN |
| `unifiedCode` | TEXT | unified码 |

### `PublicAccountDetailImpl` — public账号详情impl表

```sql
CREATE TABLE PublicAccountDetailImpl (_id INTEGER PRIMARY KEY AUTOINCREMENT,accountData BLOB,accountFlag INTEGER,accountFlag2 INTEGER,certifiedDescription TEXT,certifiedGrade INTEGER,configBackgroundColor TEXT,displayNumber TEXT,followType INTEGER,groupId INTEGER,isAgreeSyncLbs INTEGER,isConfirmed INTEGER,isMute INTEGER,isRecvMsg INTEGER,isRecvPush INTEGER,isShowFollowButton INTEGER,isShowShareButton INTEGER,isSyncLbs INTEGER,isSyncLbsSelected INTEGER,lastHistoryMsg TEXT,mShowMsgFlag INTEGER,name TEXT,protocol839Data BLOB,protocolVersion INTEGER,seqno INTEGER,sharedFollowerCount INTEGER,showFlag INTEGER,summary TEXT,uid TEXT,uin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `accountData` | BLOB | 账号数据 |
| `accountFlag` | INTEGER | 账号标志 |
| `accountFlag2` | INTEGER | 账号标志2 |
| `certifiedDescription` | TEXT | 认证描述 |
| `certifiedGrade` | INTEGER | 认证等级 |
| `configBackgroundColor` | TEXT | 配置背景颜色 |
| `displayNumber` | TEXT | 显示号码 |
| `followType` | INTEGER | 关注类型 |
| `groupId` | INTEGER | 群ID |
| `isAgreeSyncLbs` | INTEGER | 是否同意同步lbs |
| `isConfirmed` | INTEGER | 是否确认ed |
| `isMute` | INTEGER | 是否免打扰 |
| `isRecvMsg` | INTEGER | 是否接收消息 |
| `isRecvPush` | INTEGER | 是否接收推送 |
| `isShowFollowButton` | INTEGER | 是否显示关注button |
| `isShowShareButton` | INTEGER | 是否显示分享button |
| `isSyncLbs` | INTEGER | 是否同步lbs |
| `isSyncLbsSelected` | INTEGER | 是否同步lbsselected |
| `lastHistoryMsg` | TEXT | 最后历史消息 |
| `mShowMsgFlag` | INTEGER | m显示消息标志 |
| `name` | TEXT | 名称 |
| `protocol839Data` | BLOB | protocol839数据 |
| `protocolVersion` | INTEGER | protocol版本 |
| `seqno` | INTEGER | 序号no |
| `sharedFollowerCount` | INTEGER | 分享d关注er数量 |
| `showFlag` | INTEGER | 显示标志 |
| `summary` | TEXT | 摘要 |
| `uid` | TEXT | uid |
| `uin` | TEXT | QQ号/UIN |

### `PublicAccountInfo` — 公众号信息

```sql
CREATE TABLE PublicAccountInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT ,uin INTEGER UNIQUE ,uid TEXT ,name TEXT ,displayNumber TEXT ,summary TEXT ,isRecvMsg INTEGER ,isRecvPush INTEGER ,clickCount INTEGER ,certifiedGrade INTEGER ,isSyncLbs INTEGER ,showFlag INTEGER ,mShowMsgFlag INTEGER ,mIsAgreeSyncLbs INTEGER ,mIsSyncLbsSelected INTEGER ,dateTime INTEGER ,accountFlag INTEGER ,accountFlag2 INTEGER ,eqqAccountFlag INTEGER ,isShieldMsg INTEGER ,messageSettingFlag INTEGER ,extendType INTEGER ,mComparePartInt INTEGER ,mCompareSpell TEXT ,logo TEXT ,lastAIOReadTime INTEGER ,isMsgDisturb INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `uin` | INTEGER | QQ号/UIN |
| `uid` | TEXT | uid |
| `name` | TEXT | 名称 |
| `displayNumber` | TEXT | 显示号码 |
| `summary` | TEXT | 摘要 |
| `isRecvMsg` | INTEGER | 是否接收消息 |
| `isRecvPush` | INTEGER | 是否接收推送 |
| `clickCount` | INTEGER | 点击数量 |
| `certifiedGrade` | INTEGER | 认证等级 |
| `isSyncLbs` | INTEGER | 是否同步lbs |
| `showFlag` | INTEGER | 显示标志 |
| `mShowMsgFlag` | INTEGER | m显示消息标志 |
| `mIsAgreeSyncLbs` | INTEGER | mis同意同步lbs |
| `mIsSyncLbsSelected` | INTEGER | mis同步lbsselected |
| `dateTime` | INTEGER | 日期时间 |
| `accountFlag` | INTEGER | 账号标志 |
| `accountFlag2` | INTEGER | 账号标志2 |
| `eqqAccountFlag` | INTEGER | eqq账号标志 |
| `isShieldMsg` | INTEGER | 是否shield消息 |
| `messageSettingFlag` | INTEGER | 消息设置标志 |
| `extendType` | INTEGER | 扩展结束类型 |
| `mComparePartInt` | INTEGER | (mComparePartInt) |
| `mCompareSpell` | TEXT | (mCompareSpell) |
| `logo` | TEXT | 日志o |
| `lastAIOReadTime` | INTEGER | 最后aio已读时间 |
| `isMsgDisturb` | INTEGER | 是否消息disturb |

### `PushSwitchGrayTipsInfo` — 推送switchgray提示表

```sql
CREATE TABLE PushSwitchGrayTipsInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,lastShowTime INTEGER,sessionType INTEGER,showCount INTEGER,toUin TEXT,uin TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `lastShowTime` | INTEGER | 最后显示时间 |
| `sessionType` | INTEGER | 会话类型 |
| `showCount` | INTEGER | 显示数量 |
| `toUin` | TEXT | toQQ号/UIN |
| `uin` | TEXT | QQ号/UIN |

### `QQStrangerUserInfo` — qq陌生人用户表

```sql
CREATE TABLE QQStrangerUserInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,avatar TEXT,chatType INTEGER,gender INTEGER,matchSource INTEGER,matchText TEXT,nick TEXT,onlineStatus TEXT,openId TEXT,tinyId INTEGER,userType INTEGER,UNIQUE(chatType,tinyId,openId) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `avatar` | TEXT | 头像 |
| `chatType` | INTEGER | 聊天类型 |
| `gender` | INTEGER | 性别 |
| `matchSource` | INTEGER | match来源 |
| `matchText` | TEXT | match文本 |
| `nick` | TEXT | (nick) |
| `onlineStatus` | TEXT | on线状态 |
| `openId` | TEXT | openID |
| `tinyId` | INTEGER | tinyID |
| `userType` | INTEGER | 用户类型 |

### `QZoneCover` — qzone封面表

```sql
CREATE TABLE QZoneCover (_id INTEGER PRIMARY KEY AUTOINCREMENT ,uin TEXT UNIQUE ,type TEXT ,jigsaw INTEGER ,vCoverInfo BLOB ,vPhotoInfo BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `uin` | TEXT | QQ号/UIN |
| `type` | TEXT | 类型 |
| `jigsaw` | INTEGER | (jigsaw) |
| `vCoverInfo` | BLOB | v封面信息 |
| `vPhotoInfo` | BLOB | v照片信息 |

### `QzoneRedDotEntity` — qzone红包dotentity表

```sql
CREATE TABLE QzoneRedDotEntity (_id INTEGER PRIMARY KEY AUTOINCREMENT,iconUrl TEXT,isShowRedDot INTEGER,jumpSchema TEXT,timeStamp INTEGER,uin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `iconUrl` | TEXT | 图标链接 |
| `isShowRedDot` | INTEGER | 是否显示红包dot |
| `jumpSchema` | TEXT | jump结构 |
| `timeStamp` | INTEGER | 时间戳 |
| `uin` | TEXT | QQ号/UIN |

### `ReportedBanner` — 上报ed横幅表

```sql
CREATE TABLE ReportedBanner (_id INTEGER PRIMARY KEY AUTOINCREMENT,cid INTEGER UNIQUE,endtime INTEGER,md5 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `cid` | INTEGER | cID |
| `endtime` | INTEGER | 结束时间 |
| `md5` | TEXT | MD5 |

### `Reporting` — 上报ing表

```sql
CREATE TABLE Reporting (_id INTEGER PRIMARY KEY AUTOINCREMENT,mCount INTEGER,mDetail TEXT,mDetailHashCode INTEGER,mLockedCount INTEGER,mSeqKey INTEGER,mTag TEXT,UNIQUE(mTag, mDetail) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `mCount` | INTEGER | m数量 |
| `mDetail` | TEXT | m详情 |
| `mDetailHashCode` | INTEGER | m详情哈希码 |
| `mLockedCount` | INTEGER | mlocked数量 |
| `mSeqKey` | INTEGER | m序号键 |
| `mTag` | TEXT | m标签 |

### `ResourcePluginInfo` — 资源插件表

```sql
CREATE TABLE ResourcePluginInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT ,strPkgName TEXT UNIQUE ,strResName TEXT ,strResURL TEXT ,uiCurVer INTEGER ,sLanType INTEGER ,strGotoUrl TEXT ,sResSubType INTEGER ,sPriority INTEGER ,strResDesc TEXT ,uiResId INTEGER ,cDefaultState INTEGER ,cCanChangeState INTEGER ,isNew INTEGER ,cDataType INTEGER ,cLocalState INTEGER ,iPluginType INTEGER ,timeStamp INTEGER ,strNewPluginDesc TEXT ,strNewPluginURL TEXT ,lebaSearchResultType INTEGER ,pluginSetTips TEXT ,pluginBg TEXT ,flags INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `strPkgName` | TEXT | strpkg名称 |
| `strResName` | TEXT | strres名称 |
| `strResURL` | TEXT | strres链接 |
| `uiCurVer` | INTEGER | (uiCurVer) |
| `sLanType` | INTEGER | slan类型 |
| `strGotoUrl` | TEXT | strgoto链接 |
| `sResSubType` | INTEGER | sres子类型 |
| `sPriority` | INTEGER | s优先级 |
| `strResDesc` | TEXT | strres描述 |
| `uiResId` | INTEGER | uiresID |
| `cDefaultState` | INTEGER | c默认状态 |
| `cCanChangeState` | INTEGER | ccanchange状态 |
| `isNew` | INTEGER | (isNew) |
| `cDataType` | INTEGER | c数据类型 |
| `cLocalState` | INTEGER | c本地状态 |
| `iPluginType` | INTEGER | i插件类型 |
| `timeStamp` | INTEGER | 时间戳 |
| `strNewPluginDesc` | TEXT | strnew插件描述 |
| `strNewPluginURL` | TEXT | strnew插件链接 |
| `lebaSearchResultType` | INTEGER | lebasearch结果类型 |
| `pluginSetTips` | TEXT | 插件set提示 |
| `pluginBg` | TEXT | 插件背景 |
| `flags` | INTEGER | 标志s |

### `RoamSetting` — roam设置表

```sql
CREATE TABLE RoamSetting (_id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT UNIQUE,value TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `path` | TEXT | 路径 |
| `value` | TEXT | 值 |

### `SearchHistory` — search历史表

```sql
CREATE TABLE SearchHistory (_id INTEGER PRIMARY KEY AUTOINCREMENT,count INTEGER,displayName TEXT,extralInfo TEXT,key TEXT UNIQUE,time INTEGER,troopUin TEXT,type INTEGER,uin TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `count` | INTEGER | 数量 |
| `displayName` | TEXT | 群成员群名片(;分隔,与memberlist同序) |
| `extralInfo` | TEXT | 扩展l信息 |
| `key` | TEXT | 键 |
| `time` | INTEGER | 时间 |
| `troopUin` | TEXT | 群(QQ)QQ号/UIN |
| `type` | INTEGER | 类型 |
| `uin` | TEXT | QQ号/UIN |

### `Setting` — 设置表

```sql
CREATE TABLE Setting (_id INTEGER PRIMARY KEY AUTOINCREMENT,apngFaceFlag INTEGER,bFaceFlags INTEGER,bHeadType INTEGER,bSourceType INTEGER,bUsrType INTEGER,dynamicZplanFaceFlag INTEGER,headImgTimestamp INTEGER,staticZplanFaceFlag INTEGER,systemHeadID INTEGER,uin TEXT UNIQUE,updateTimestamp INTEGER,url TEXT,zplanFaceBgUrl TEXT,zplanFaceClipPercent INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `apngFaceFlag` | INTEGER | apngface标志 |
| `bFaceFlags` | INTEGER | bface标志s |
| `bHeadType` | INTEGER | b头像类型 |
| `bSourceType` | INTEGER | b来源类型 |
| `bUsrType` | INTEGER | busr类型 |
| `dynamicZplanFaceFlag` | INTEGER | dynamiczplanface标志 |
| `headImgTimestamp` | INTEGER | 头像图片时间戳 |
| `staticZplanFaceFlag` | INTEGER | 统计iczplanface标志 |
| `systemHeadID` | INTEGER | 系统头像ID |
| `uin` | TEXT | QQ号/UIN |
| `updateTimestamp` | INTEGER | 更新时间stamp |
| `url` | TEXT | 链接 |
| `zplanFaceBgUrl` | TEXT | zplanface背景链接 |
| `zplanFaceClipPercent` | INTEGER | zplanfaceclip百分比 |

### `ShieldListInfo` — 屏蔽列表

```sql
CREATE TABLE ShieldListInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT ,uin TEXT ,flags INTEGER ,source_id INTEGER ,source_sub_id INTEGER,UNIQUE(uin) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `uin` | TEXT | QQ号/UIN |
| `flags` | INTEGER | 标志s |
| `source_id` | INTEGER | 来源ID |
| `source_sub_id` | INTEGER | 来源subID |

### `TempMsgInfo` — 临时消息表

```sql
CREATE TABLE TempMsgInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,timeStamp INTEGER,typeWithUin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `timeStamp` | INTEGER | 时间戳 |
| `typeWithUin` | TEXT | 类型withQQ号/UIN |

### `TofuItem` — tofu项表

```sql
CREATE TABLE TofuItem (_id INTEGER PRIMARY KEY AUTOINCREMENT,busId INTEGER,frdUin INTEGER,lastPullTsLocal INTEGER,lastPullTsSvr INTEGER,msgData BLOB,pullInterval INTEGER,UNIQUE(frdUin,busId) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `busId` | INTEGER | busID |
| `frdUin` | INTEGER | frdQQ号/UIN |
| `lastPullTsLocal` | INTEGER | 最后拉取时间戳本地 |
| `lastPullTsSvr` | INTEGER | 最后拉取时间戳服务器 |
| `msgData` | BLOB | 消息数据 |
| `pullInterval` | INTEGER | 拉取interval |

### `TofuLimitMsg` — tofu限制消息表

```sql
CREATE TABLE TofuLimitMsg (_id INTEGER PRIMARY KEY AUTOINCREMENT,businessId INTEGER,businessMsgId TEXT,extra TEXT,flag INTEGER,friendUin TEXT,insertMsgTime INTEGER,UNIQUE(businessId,businessMsgId) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `businessId` | INTEGER | businessID |
| `businessMsgId` | TEXT | business消息ID |
| `extra` | TEXT | 扩展 |
| `flag` | INTEGER | 标志 |
| `friendUin` | TEXT | 好友QQ号/UIN |
| `insertMsgTime` | INTEGER | 插入消息时间 |

### `TroopEssenceMsgItem` — 群(QQ)essence消息项表

```sql
CREATE TABLE TroopEssenceMsgItem (_id INTEGER PRIMARY KEY AUTOINCREMENT,graytipuniseq INTEGER,msgRandom INTEGER,msgSenderUin TEXT,msgSeq INTEGER,opTime INTEGER,opType INTEGER,opUin TEXT,troopUin INTEGER,UNIQUE(troopUin,msgSeq,msgRandom) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `graytipuniseq` | INTEGER | gray提示uni序号 |
| `msgRandom` | INTEGER | 消息random |
| `msgSenderUin` | TEXT | 消息发送者QQ号/UIN |
| `msgSeq` | INTEGER | 消息序号 |
| `opTime` | INTEGER | op时间 |
| `opType` | INTEGER | op类型 |
| `opUin` | TEXT | opQQ号/UIN |
| `troopUin` | INTEGER | 群(QQ)QQ号/UIN |

### `TroopExtDBInfo` — 群扩展信息(QQ老库,文本混淆)

```sql
CREATE TABLE TroopExtDBInfo (_id INTEGER PRIMARY KEY AUTOINCREMENT,atOrReplyMeUins TEXT,avatarId INTEGER,cGroupRankUserFlag INTEGER,cNewGroupRankUserFlag INTEGER,comparePartInt INTEGER,compareSpell TEXT,dailyNewMemberUins TEXT,feedsId TEXT,fileVideoIsWhite INTEGER,fileVideoReqInterval INTEGER,gameSwitchStatus INTEGER,hadInitLevelInfo INTEGER,headerUinsNew TEXT,headerUinsOld TEXT,insertBAFTipCount INTEGER,lastBAFTipMsgUniSeq INTEGER,lastInsertBAFTipTime INTEGER,lastMsgUpdateMyHonorRichTime INTEGER,memberNumClient INTEGER,myHonorList TEXT,myHonorRichFlag INTEGER,newLevelMapStr TEXT,newTroopNameTimeStamp INTEGER,oldMemberNickIconSeq INTEGER,picListJson TEXT,showGameSwitchStatus INTEGER,specialClass INTEGER,strLastAnnouncement TEXT,troopGuildSwitchOpen INTEGER,troopHonorGrayFlag INTEGER,troopRepeatType INTEGER,troopSettingMemberList TEXT,troopType INTEGER,troopUin TEXT,UNIQUE(troopUin) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `atOrReplyMeUins` | TEXT | ator回复meQQ号/UINs |
| `avatarId` | INTEGER | 头像ID |
| `cGroupRankUserFlag` | INTEGER | c群/组排名用户标志 |
| `cNewGroupRankUserFlag` | INTEGER | cnew群/组排名用户标志 |
| `comparePartInt` | INTEGER | (comparePartInt) |
| `compareSpell` | TEXT | (compareSpell) |
| `dailyNewMemberUins` | TEXT | dailynew成员QQ号/UINs |
| `feedsId` | TEXT | 信息流sID |
| `fileVideoIsWhite` | INTEGER | 文件视频iswhite |
| `fileVideoReqInterval` | INTEGER | 文件视频reqinterval |
| `gameSwitchStatus` | INTEGER | 游戏switch状态 |
| `hadInitLevelInfo` | INTEGER | 曾init级别信息 |
| `headerUinsNew` | TEXT | 头像erQQ号/UINsnew |
| `headerUinsOld` | TEXT | 头像erQQ号/UINsold |
| `insertBAFTipCount` | INTEGER | 插入baf提示数量 |
| `lastBAFTipMsgUniSeq` | INTEGER | 最后baf提示消息uni序号 |
| `lastInsertBAFTipTime` | INTEGER | 最后插入baf提示时间 |
| `lastMsgUpdateMyHonorRichTime` | INTEGER | 最后消息更新我的honorrich时间 |
| `memberNumClient` | INTEGER | 成员数量客户端 |
| `myHonorList` | TEXT | 我的honor列表 |
| `myHonorRichFlag` | INTEGER | 我的honorrich标志 |
| `newLevelMapStr` | TEXT | new级别mapstr |
| `newTroopNameTimeStamp` | INTEGER | new群(QQ)名称时间戳 |
| `oldMemberNickIconSeq` | INTEGER | old成员nick图标序号 |
| `picListJson` | TEXT | 图片列表JSON |
| `showGameSwitchStatus` | INTEGER | 显示游戏switch状态 |
| `specialClass` | INTEGER | (specialClass) |
| `strLastAnnouncement` | TEXT | str最后公告ment |
| `troopGuildSwitchOpen` | INTEGER | 群(QQ)guildswitchopen |
| `troopHonorGrayFlag` | INTEGER | 群(QQ)honorgray标志 |
| `troopRepeatType` | INTEGER | 群(QQ)repeat类型 |
| `troopSettingMemberList` | TEXT | 群(QQ)设置成员列表 |
| `troopType` | INTEGER | 群(QQ)类型 |
| `troopUin` | TEXT | 群(QQ)QQ号/UIN |

### `TroopMemberIconData` — 群(QQ)成员图标数据表

```sql
CREATE TABLE TroopMemberIconData (_id INTEGER PRIMARY KEY AUTOINCREMENT,memberUin TEXT UNIQUE,nickIconBytes BLOB,UNIQUE(memberUin) ON CONFLICT REPLACE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `memberUin` | TEXT | 成员QQ号/UIN |
| `nickIconBytes` | BLOB | nick图标字节 |

### `TroopMemberInfoExt` — 群成员信息(QQ老库)

```sql
CREATE TABLE TroopMemberInfoExt (_id INTEGER PRIMARY KEY AUTOINCREMENT,commonFrdCnt INTEGER,flagEx3 INTEGER,hwIdentity INTEGER,lastMsgUpdateHonorRichTime INTEGER,memberUin TEXT,nickIconRepeatMsgBuffer BLOB,recommendRemark TEXT,showNameForPinyin TEXT,showNamePinyinAll TEXT,showNamePinyinFirst TEXT,troopUin TEXT,UNIQUE(troopUin,memberUin) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `commonFrdCnt` | INTEGER | (commonFrdCnt) |
| `flagEx3` | INTEGER | 标志ex3 |
| `hwIdentity` | INTEGER | hwIDentity |
| `lastMsgUpdateHonorRichTime` | INTEGER | 最后消息更新honorrich时间 |
| `memberUin` | TEXT | 成员QQ号/UIN |
| `nickIconRepeatMsgBuffer` | BLOB | nick图标repeat消息缓冲 |
| `recommendRemark` | TEXT | 推荐备注 |
| `showNameForPinyin` | TEXT | 显示名称for置顶yin |
| `showNamePinyinAll` | TEXT | 显示名称置顶yinall |
| `showNamePinyinFirst` | TEXT | 显示名称置顶yin首 |
| `troopUin` | TEXT | 群(QQ)QQ号/UIN |

### `applets_account_info` — 应用le时间戳账号表

```sql
CREATE TABLE applets_account_info (_id INTEGER PRIMARY KEY AUTOINCREMENT,appInfoDetail BLOB,faceUrl TEXT,faceUrlSimple TEXT,nick TEXT,uin TEXT UNIQUE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `appInfoDetail` | BLOB | 应用信息详情 |
| `faceUrl` | TEXT | face链接 |
| `faceUrlSimple` | TEXT | face链接simple |
| `nick` | TEXT | (nick) |
| `uin` | TEXT | QQ号/UIN |

### `mr_data_line` — mr数据线表

```sql
CREATE TABLE mr_data_line (_id INTEGER PRIMARY KEY AUTOINCREMENT,busId INTEGER,filename TEXT,filesize INTEGER,forwardTroopFileEntrance INTEGER,groupId INTEGER,groupIndex INTEGER,groupSize INTEGER,issuc INTEGER,md5 BLOB,path TEXT,progress REAL,serverPath TEXT,sessionid INTEGER,thumbPath TEXT,extInt INTEGER,extLong INTEGER,extStr TEXT,extraflag INTEGER,frienduin TEXT,isValid INTEGER,isread INTEGER,issend INTEGER,istroop INTEGER,longMsgCount INTEGER,longMsgId INTEGER,longMsgIndex INTEGER,msgData BLOB,msgId INTEGER,msgUid INTEGER,msgseq INTEGER,msgtype INTEGER,selfuin TEXT,sendFailCode INTEGER,senderuin TEXT,shmsgseq INTEGER,time INTEGER,uniseq INTEGER,versionCode INTEGER,vipBubbleID INTEGER,UNIQUE(time,msgid) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `busId` | INTEGER | busID |
| `filename` | TEXT | 文件名称 |
| `filesize` | INTEGER | 文件大小 |
| `forwardTroopFileEntrance` | INTEGER | 转发群(QQ)文件entrance |
| `groupId` | INTEGER | 群ID |
| `groupIndex` | INTEGER | 群/组索引 |
| `groupSize` | INTEGER | 群/组大小 |
| `issuc` | INTEGER | (issuc) |
| `md5` | BLOB | MD5 |
| `path` | TEXT | 路径 |
| `progress` | REAL | (progress) |
| `serverPath` | TEXT | 服务器路径 |
| `sessionid` | INTEGER | 会话ID |
| `thumbPath` | TEXT | 缩略图路径 |
| `extInt` | INTEGER | 扩展int |
| `extLong` | INTEGER | 扩展long |
| `extStr` | TEXT | 扩展str |
| `extraflag` | INTEGER | 扩展标志 |
| `frienduin` | TEXT | 好友QQ号/UIN |
| `isValid` | INTEGER | 是否有效 |
| `isread` | INTEGER | 是否已读 |
| `issend` | INTEGER | 方向: 0=收到 1=我发出 |
| `istroop` | INTEGER | 是否群(QQ) |
| `longMsgCount` | INTEGER | long消息数量 |
| `longMsgId` | INTEGER | long消息ID |
| `longMsgIndex` | INTEGER | long消息索引 |
| `msgData` | BLOB | 消息数据 |
| `msgId` | INTEGER | 消息ID |
| `msgUid` | INTEGER | 消息uid |
| `msgseq` | INTEGER | 消息序号 |
| `msgtype` | INTEGER | 消息类型 |
| `selfuin` | TEXT | 自己QQ号/UIN |
| `sendFailCode` | INTEGER | 发送失败码 |
| `senderuin` | TEXT | 发送者QQ号/UIN |
| `shmsgseq` | INTEGER | sh消息序号 |
| `time` | INTEGER | 时间 |
| `uniseq` | INTEGER | uni序号 |
| `versionCode` | INTEGER | 版本码 |
| `vipBubbleID` | INTEGER | VIPbubbleID |

### `mr_data_line_ipad` — mr数据线ip广告表

```sql
CREATE TABLE mr_data_line_ipad (_id INTEGER PRIMARY KEY AUTOINCREMENT,busId INTEGER,filename TEXT,filesize INTEGER,forwardTroopFileEntrance INTEGER,groupId INTEGER,groupIndex INTEGER,groupSize INTEGER,issuc INTEGER,md5 BLOB,path TEXT,progress REAL,serverPath TEXT,sessionid INTEGER,thumbPath TEXT,extInt INTEGER,extLong INTEGER,extStr TEXT,extraflag INTEGER,frienduin TEXT,isValid INTEGER,isread INTEGER,issend INTEGER,istroop INTEGER,longMsgCount INTEGER,longMsgId INTEGER,longMsgIndex INTEGER,msgData BLOB,msgId INTEGER,msgUid INTEGER,msgseq INTEGER,msgtype INTEGER,selfuin TEXT,sendFailCode INTEGER,senderuin TEXT,shmsgseq INTEGER,time INTEGER,uniseq INTEGER,versionCode INTEGER,vipBubbleID INTEGER,UNIQUE(time,msgid) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `busId` | INTEGER | busID |
| `filename` | TEXT | 文件名称 |
| `filesize` | INTEGER | 文件大小 |
| `forwardTroopFileEntrance` | INTEGER | 转发群(QQ)文件entrance |
| `groupId` | INTEGER | 群ID |
| `groupIndex` | INTEGER | 群/组索引 |
| `groupSize` | INTEGER | 群/组大小 |
| `issuc` | INTEGER | (issuc) |
| `md5` | BLOB | MD5 |
| `path` | TEXT | 路径 |
| `progress` | REAL | (progress) |
| `serverPath` | TEXT | 服务器路径 |
| `sessionid` | INTEGER | 会话ID |
| `thumbPath` | TEXT | 缩略图路径 |
| `extInt` | INTEGER | 扩展int |
| `extLong` | INTEGER | 扩展long |
| `extStr` | TEXT | 扩展str |
| `extraflag` | INTEGER | 扩展标志 |
| `frienduin` | TEXT | 好友QQ号/UIN |
| `isValid` | INTEGER | 是否有效 |
| `isread` | INTEGER | 是否已读 |
| `issend` | INTEGER | 方向: 0=收到 1=我发出 |
| `istroop` | INTEGER | 是否群(QQ) |
| `longMsgCount` | INTEGER | long消息数量 |
| `longMsgId` | INTEGER | long消息ID |
| `longMsgIndex` | INTEGER | long消息索引 |
| `msgData` | BLOB | 消息数据 |
| `msgId` | INTEGER | 消息ID |
| `msgUid` | INTEGER | 消息uid |
| `msgseq` | INTEGER | 消息序号 |
| `msgtype` | INTEGER | 消息类型 |
| `selfuin` | TEXT | 自己QQ号/UIN |
| `sendFailCode` | INTEGER | 发送失败码 |
| `senderuin` | TEXT | 发送者QQ号/UIN |
| `shmsgseq` | INTEGER | sh消息序号 |
| `time` | INTEGER | 时间 |
| `uniseq` | INTEGER | uni序号 |
| `versionCode` | INTEGER | 版本码 |
| `vipBubbleID` | INTEGER | VIPbubbleID |

### `mr_fileManager` — mr文件manager表

```sql
CREATE TABLE mr_fileManager (_id INTEGER PRIMARY KEY AUTOINCREMENT,TroopUin INTEGER,Uuid TEXT,WeiYunDirKey TEXT,WeiYunFileId TEXT,apkSafeDetailUrl TEXT,apkSafeLevel INTEGER,apkSafeMsg TEXT,bCannotPlay INTEGER,bDelInAio INTEGER,bDelInFM INTEGER,bOnceSuccess INTEGER,bSend INTEGER,bombData BLOB,busId INTEGER,channelId TEXT,channelName TEXT,cloudType INTEGER,dbVer INTEGER,dlGourpIndex INTEGER,dlGroupCount INTEGER,dlGroupId INTEGER,duplicateAssistantId TEXT,duplicateEntitySessionId INTEGER,duplicateFilePath TEXT,errCode INTEGER,fOlRecvProgressOnNotify REAL,fOlRecvSpeed REAL,fProgress REAL,fileAssistantId TEXT,fileIdCrc TEXT,fileName TEXT,fileSize INTEGER,forwardTroopFileEntrance INTEGER,fromScene INTEGER,fwSrcNtMsgId INTEGER,fwSrcPeerType INTEGER,fwSrcPeerUid TEXT,fwSrcUniseq INTEGER,guildId TEXT,guildName TEXT,httpsDomain TEXT,imgHeight INTEGER,imgWidth INTEGER,isDuplicateFile INTEGER,isReaded INTEGER,isZipInnerFile INTEGER,lastTime INTEGER,localModifyTime INTEGER,mTroopFileVideoReqInterval INTEGER,msgSeq INTEGER,msgTime INTEGER,msgUid INTEGER,nFileType INTEGER,nOLfileSessionId INTEGER,nOlSenderProgress INTEGER,nOpType INTEGER,nRelatedSessionId INTEGER,nSessionId INTEGER UNIQUE,nWeiYunSrcType INTEGER,ntChatType INTEGER,ntMsgId INTEGER,ntSubMsgID INTEGER,peerNick TEXT,peerType INTEGER,peerUid TEXT,peerUin TEXT,selfUin TEXT,srvTime INTEGER,status INTEGER,str10Md5 TEXT,strApkPackageName TEXT,strFavFileId TEXT,strFavId TEXT,strFileMd5 TEXT,strFilePath TEXT,strFileSHA TEXT,strFileSha3 TEXT,strLargeThumPath TEXT,strMiddleThumPath TEXT,strQRUrl TEXT,strServerPath TEXT,strSrcName TEXT,strThumbPath TEXT,strTroopFileID TEXT,strTroopFilePath TEXT,strTroopFileSha1 TEXT,strTroopFileUuid TEXT,structMsgSeq INTEGER,thumbInvalidCode INTEGER,tmpSessionFromPhone TEXT,tmpSessionRelatedUin TEXT,tmpSessionToPhone TEXT,tmpSessionType INTEGER,uniseq INTEGER,yybApkIconUrl TEXT,yybApkName TEXT,yybApkPackageName TEXT,zipFileId TEXT,zipFilePath TEXT,zipInnerPath TEXT,zipType INTEGER,UNIQUE(nSessionId) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `TroopUin` | INTEGER | 群(QQ)QQ号/UIN |
| `Uuid` | TEXT | UUID |
| `WeiYunDirKey` | TEXT | weiyundir键 |
| `WeiYunFileId` | TEXT | weiyun文件ID |
| `apkSafeDetailUrl` | TEXT | apksafe详情链接 |
| `apkSafeLevel` | INTEGER | apksafe级别 |
| `apkSafeMsg` | TEXT | apksafe消息 |
| `bCannotPlay` | INTEGER | bcannot播放 |
| `bDelInAio` | INTEGER | (bDelInAio) |
| `bDelInFM` | INTEGER | (bDelInFM) |
| `bOnceSuccess` | INTEGER | bonce成功 |
| `bSend` | INTEGER | b发送 |
| `bombData` | BLOB | boMB数据 |
| `busId` | INTEGER | busID |
| `channelId` | TEXT | 渠道ID |
| `channelName` | TEXT | 渠道名称 |
| `cloudType` | INTEGER | cloud类型 |
| `dbVer` | INTEGER | (dbVer) |
| `dlGourpIndex` | INTEGER | dlgour置顶dex |
| `dlGroupCount` | INTEGER | dl群/组数量 |
| `dlGroupId` | INTEGER | dl群ID |
| `duplicateAssistantId` | TEXT | duplicateassistantID |
| `duplicateEntitySessionId` | INTEGER | duplicateentity会话ID |
| `duplicateFilePath` | TEXT | duplicate文件路径 |
| `errCode` | INTEGER | err码 |
| `fOlRecvProgressOnNotify` | REAL | fol接收progresson通知 |
| `fOlRecvSpeed` | REAL | fol接收速度 |
| `fProgress` | REAL | (fProgress) |
| `fileAssistantId` | TEXT | 文件assistantID |
| `fileIdCrc` | TEXT | 文件IDcrc |
| `fileName` | TEXT | 文件名称 |
| `fileSize` | INTEGER | 文件大小 |
| `forwardTroopFileEntrance` | INTEGER | 转发群(QQ)文件entrance |
| `fromScene` | INTEGER | from场景 |
| `fwSrcNtMsgId` | INTEGER | fwsrcnt消息ID |
| `fwSrcPeerType` | INTEGER | fwsrcpeer类型 |
| `fwSrcPeerUid` | TEXT | fwsrcpeeruid |
| `fwSrcUniseq` | INTEGER | fwsrcuni序号 |
| `guildId` | TEXT | guildID |
| `guildName` | TEXT | guild名称 |
| `httpsDomain` | TEXT | (httpsDomain) |
| `imgHeight` | INTEGER | 图片高 |
| `imgWidth` | INTEGER | 图片宽 |
| `isDuplicateFile` | INTEGER | 是否duplicate文件 |
| `isReaded` | INTEGER | 是否已读ed |
| `isZipInnerFile` | INTEGER | 是否zi置顶ner文件 |
| `lastTime` | INTEGER | 最后时间 |
| `localModifyTime` | INTEGER | 本地修改时间 |
| `mTroopFileVideoReqInterval` | INTEGER | m群(QQ)文件视频reqinterval |
| `msgSeq` | INTEGER | 消息序号 |
| `msgTime` | INTEGER | 消息时间 |
| `msgUid` | INTEGER | 消息uid |
| `nFileType` | INTEGER | n文件类型 |
| `nOLfileSessionId` | INTEGER | nol文件会话ID |
| `nOlSenderProgress` | INTEGER | nol发送者progress |
| `nOpType` | INTEGER | nop类型 |
| `nRelatedSessionId` | INTEGER | nre纬度ed会话ID |
| `nSessionId` | INTEGER | n会话ID |
| `nWeiYunSrcType` | INTEGER | nweiyunsrc类型 |
| `ntChatType` | INTEGER | nt聊天类型 |
| `ntMsgId` | INTEGER | nt消息ID |
| `ntSubMsgID` | INTEGER | n时间戳ub消息ID |
| `peerNick` | TEXT | (peerNick) |
| `peerType` | INTEGER | peer类型 |
| `peerUid` | TEXT | peeruid |
| `peerUin` | TEXT | peerQQ号/UIN |
| `selfUin` | TEXT | 自己QQ号/UIN |
| `srvTime` | INTEGER | srv时间 |
| `status` | INTEGER | 状态 |
| `str10Md5` | TEXT | str10MD5 |
| `strApkPackageName` | TEXT | strapk包名称 |
| `strFavFileId` | TEXT | strfav文件ID |
| `strFavId` | TEXT | strfavID |
| `strFileMd5` | TEXT | str文件MD5 |
| `strFilePath` | TEXT | str文件路径 |
| `strFileSHA` | TEXT | str文件sha |
| `strFileSha3` | TEXT | str文件sha3 |
| `strLargeThumPath` | TEXT | strlargethum路径 |
| `strMiddleThumPath` | TEXT | strmIDdlethum路径 |
| `strQRUrl` | TEXT | str二维码链接 |
| `strServerPath` | TEXT | str服务器路径 |
| `strSrcName` | TEXT | strsrc名称 |
| `strThumbPath` | TEXT | str缩略图路径 |
| `strTroopFileID` | TEXT | str群(QQ)文件ID |
| `strTroopFilePath` | TEXT | str群(QQ)文件路径 |
| `strTroopFileSha1` | TEXT | str群(QQ)文件sha1 |
| `strTroopFileUuid` | TEXT | str群(QQ)文件UUID |
| `structMsgSeq` | INTEGER | struct消息序号 |
| `thumbInvalidCode` | INTEGER | 缩略图in有效码 |
| `tmpSessionFromPhone` | TEXT | tmp会话from手机 |
| `tmpSessionRelatedUin` | TEXT | tmp会话re纬度edQQ号/UIN |
| `tmpSessionToPhone` | TEXT | tmp会话置顶hone |
| `tmpSessionType` | INTEGER | tmp会话类型 |
| `uniseq` | INTEGER | uni序号 |
| `yybApkIconUrl` | TEXT | yybapk图标链接 |
| `yybApkName` | TEXT | yybapk名称 |
| `yybApkPackageName` | TEXT | yybapk包名称 |
| `zipFileId` | TEXT | zip文件ID |
| `zipFilePath` | TEXT | zip文件路径 |
| `zipInnerPath` | TEXT | zi置顶ner路径 |
| `zipType` | INTEGER | zip类型 |

### `mr_friend_D4FCC05BD8205C41FBE4F2645BF0C6B8_New` — mr好友d4fcc05bd8205c41fbe4f2645bf0c6b8表

```sql
CREATE TABLE mr_friend_D4FCC05BD8205C41FBE4F2645BF0C6B8_New (_id INTEGER PRIMARY KEY AUTOINCREMENT,extInt INTEGER,extLong INTEGER,extStr TEXT,extraflag INTEGER,frienduin TEXT,isValid INTEGER,isread INTEGER,issend INTEGER,istroop INTEGER,longMsgCount INTEGER,longMsgId INTEGER,longMsgIndex INTEGER,msgData BLOB,msgId INTEGER,msgUid INTEGER,msgseq INTEGER,msgtype INTEGER,selfuin TEXT,sendFailCode INTEGER,senderuin TEXT,shmsgseq INTEGER,time INTEGER,uniseq INTEGER,versionCode INTEGER,vipBubbleID INTEGER,UNIQUE(time,senderuin,msgData,istroop,shmsgseq,msgseq) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `extInt` | INTEGER | 扩展int |
| `extLong` | INTEGER | 扩展long |
| `extStr` | TEXT | 扩展str |
| `extraflag` | INTEGER | 扩展标志 |
| `frienduin` | TEXT | 好友QQ号/UIN |
| `isValid` | INTEGER | 是否有效 |
| `isread` | INTEGER | 是否已读 |
| `issend` | INTEGER | 方向: 0=收到 1=我发出 |
| `istroop` | INTEGER | 是否群(QQ) |
| `longMsgCount` | INTEGER | long消息数量 |
| `longMsgId` | INTEGER | long消息ID |
| `longMsgIndex` | INTEGER | long消息索引 |
| `msgData` | BLOB | 消息数据 |
| `msgId` | INTEGER | 消息ID |
| `msgUid` | INTEGER | 消息uid |
| `msgseq` | INTEGER | 消息序号 |
| `msgtype` | INTEGER | 消息类型 |
| `selfuin` | TEXT | 自己QQ号/UIN |
| `sendFailCode` | INTEGER | 发送失败码 |
| `senderuin` | TEXT | 发送者QQ号/UIN |
| `shmsgseq` | INTEGER | sh消息序号 |
| `time` | INTEGER | 时间 |
| `uniseq` | INTEGER | uni序号 |
| `versionCode` | INTEGER | 版本码 |
| `vipBubbleID` | INTEGER | VIPbubbleID |

### `mr_friend_FA246D0262C3925617B0C72BB20EEB1D_New` — mr好友fa246d0262c3925617b0c72bb20eeb1d表

```sql
CREATE TABLE mr_friend_FA246D0262C3925617B0C72BB20EEB1D_New (_id INTEGER PRIMARY KEY AUTOINCREMENT,extInt INTEGER,extLong INTEGER,extStr TEXT,extraflag INTEGER,frienduin TEXT,isValid INTEGER,isread INTEGER,issend INTEGER,istroop INTEGER,longMsgCount INTEGER,longMsgId INTEGER,longMsgIndex INTEGER,msgData BLOB,msgId INTEGER,msgUid INTEGER,msgseq INTEGER,msgtype INTEGER,selfuin TEXT,sendFailCode INTEGER,senderuin TEXT,shmsgseq INTEGER,time INTEGER,uniseq INTEGER,versionCode INTEGER,vipBubbleID INTEGER,UNIQUE(time,senderuin,msgData,istroop,shmsgseq,msgseq) ON CONFLICT IGNORE)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `extInt` | INTEGER | 扩展int |
| `extLong` | INTEGER | 扩展long |
| `extStr` | TEXT | 扩展str |
| `extraflag` | INTEGER | 扩展标志 |
| `frienduin` | TEXT | 好友QQ号/UIN |
| `isValid` | INTEGER | 是否有效 |
| `isread` | INTEGER | 是否已读 |
| `issend` | INTEGER | 方向: 0=收到 1=我发出 |
| `istroop` | INTEGER | 是否群(QQ) |
| `longMsgCount` | INTEGER | long消息数量 |
| `longMsgId` | INTEGER | long消息ID |
| `longMsgIndex` | INTEGER | long消息索引 |
| `msgData` | BLOB | 消息数据 |
| `msgId` | INTEGER | 消息ID |
| `msgUid` | INTEGER | 消息uid |
| `msgseq` | INTEGER | 消息序号 |
| `msgtype` | INTEGER | 消息类型 |
| `selfuin` | TEXT | 自己QQ号/UIN |
| `sendFailCode` | INTEGER | 发送失败码 |
| `senderuin` | TEXT | 发送者QQ号/UIN |
| `shmsgseq` | INTEGER | sh消息序号 |
| `time` | INTEGER | 时间 |
| `uniseq` | INTEGER | uni序号 |
| `versionCode` | INTEGER | 版本码 |
| `vipBubbleID` | INTEGER | VIPbubbleID |

### `recent` — 最近表

```sql
CREATE TABLE recent (_id INTEGER PRIMARY KEY AUTOINCREMENT,displayName TEXT,isHiddenChat INTEGER default 0,lFlag INTEGER default 0,lastmsgdrafttime INTEGER default 0,lastmsgtime INTEGER,mIsParsed INTEGER,msgData BLOB,msgType INTEGER,opTime INTEGER default 0,parceledRecentBaseData BLOB,showUpTime INTEGER default 0,troopUin TEXT,type INTEGER,uin TEXT,UNIQUE(uin,type) ON CONFLICT FAIL)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `_id` | INTEGER | ID |
| `displayName` | TEXT | 群成员群名片(;分隔,与memberlist同序) |
| `isHiddenChat` | INTEGER | 是否隐藏聊天 |
| `lFlag` | INTEGER | l标志 |
| `lastmsgdrafttime` | INTEGER | 最后消息草稿时间 |
| `lastmsgtime` | INTEGER | 最后消息时间 |
| `mIsParsed` | INTEGER | (mIsParsed) |
| `msgData` | BLOB | 消息数据 |
| `msgType` | INTEGER | 消息类型 |
| `opTime` | INTEGER | op时间 |
| `parceledRecentBaseData` | BLOB | parceled最近base数据 |
| `showUpTime` | INTEGER | 显示up时间 |
| `troopUin` | TEXT | 群(QQ)QQ号/UIN |
| `type` | INTEGER | 类型 |
| `uin` | TEXT | QQ号/UIN |

