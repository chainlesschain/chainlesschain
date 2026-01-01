// 在浏览器控制台执行此代码创建测试DID

const testData = JSON.parse(localStorage.getItem('chainlesschain_h5_data') || '{}')

// 初始化数据结构
if (!testData.did_identities) {
  testData.did_identities = []
}

// 创建测试DID身份
const testDID = {
  did: 'did:chainlesschain:testuser123456',
  nickname: '测试用户',
  bio: '这是一个测试账号',
  avatar_path: '',
  public_key_sign: 'test_public_key_sign',
  public_key_encrypt: 'test_public_key_encrypt',
  encrypted_private_key_sign: 'test_encrypted_private_key_sign',
  encrypted_private_key_encrypt: 'test_encrypted_private_key_encrypt',
  did_document: JSON.stringify({
    id: 'did:chainlesschain:testuser123456',
    publicKey: [{
      id: 'did:chainlesschain:testuser123456#keys-1',
      type: 'Ed25519VerificationKey2018',
      publicKeyBase58: 'test_public_key_sign'
    }]
  }),
  is_default: 1,
  is_active: 1,
  created_at: Date.now(),
  updated_at: Date.now()
}

testData.did_identities.push(testDID)

// 保存数据
localStorage.setItem('chainlesschain_h5_data', JSON.stringify(testData))

console.log('✅ 测试DID创建成功！')
console.log('DID:', testDID.did)
console.log('昵称:', testDID.nickname)
console.log('\n现在请刷新页面（F5）然后点击"项目"Tab测试')

// 返回创建的DID信息
testDID
