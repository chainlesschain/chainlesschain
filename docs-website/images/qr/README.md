# 二维码生成说明

## 当前状态

当前提供的是一个**示例二维码SVG**，用于占位显示。

## 如何生成真实的二维码

### 方法1：使用在线工具（推荐）

访问以下任一网站生成二维码：

1. **QRCode Monkey** - https://www.qrcode-monkey.com/
   - 支持自定义颜色、Logo
   - 高质量PNG/SVG导出

2. **草料二维码** - https://cli.im/
   - 国内访问快
   - 支持统计功能

3. **二维工坊** - https://www.2weima.com/
   - 简单易用
   - 免费无广告

**生成步骤：**
1. 输入 Android APK 下载链接：
   ```
   https://github.com/chainlesschain/chainlesschain/releases/latest/download/ChainlessChain-Android.apk
   ```

2. （可选）上传 logo.png 作为二维码中心图标

3. 选择高质量（至少 300x300px）

4. 下载为 PNG 格式

5. 重命名为 `android-download.png` 并替换当前的 `android-download.svg`

### 方法2：使用 Node.js 生成

```bash
# 安装二维码生成工具
npm install -g qrcode

# 生成二维码
qrcode -o android-download.png "https://github.com/chainlesschain/chainlesschain/releases/latest"
```

### 方法3：使用 Python 生成

```python
# 安装库
pip install qrcode[pil]

# 生成二维码
import qrcode

# 创建二维码
qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=10,
    border=4,
)

# 添加数据
qr.add_data('https://github.com/chainlesschain/chainlesschain/releases/latest')
qr.make(fit=True)

# 创建图像
img = qr.make_image(fill_color="black", back_color="white")
img.save('android-download.png')
```

### 方法4：使用 API 服务

**Google Charts API（已弃用，但仍可用）：**
```
https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=https://github.com/chainlesschain/chainlesschain/releases/latest
```

直接在浏览器打开上述链接，右键保存图片即可。

## 建议

- **尺寸**: 300x300px 或更大
- **格式**: PNG（带透明背景更佳）
- **纠错级别**: 选择 H（高）级别，即使部分损坏也能扫描
- **添加Logo**: 可以在二维码中心添加项目Logo，提升品牌识别度

## 下载链接

根据实际发布位置，二维码应指向：

- **GitHub Releases**: `https://github.com/chainlesschain/chainlesschain/releases/latest`
- **Gitee Releases**: `https://gitee.com/chainlesschaincn/chainlesschain/releases/latest`
- **自有CDN**: 待配置

## 测试

生成后请务必测试二维码：
1. 使用手机扫描
2. 确认能正确跳转到下载页面
3. 检查下载链接是否有效
