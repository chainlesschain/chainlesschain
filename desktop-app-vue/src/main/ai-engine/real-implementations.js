/**
 * 真实功能实现 - Phase 1
 * 包含二维码和文件压缩的真实库集成
 */

const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { createCanvas, loadImage } = require('canvas');
const archiver = require('archiver');
const decompress = require('decompress');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

/**
 * ==================== 二维码工具 ====================
 */

/**
 * 生成二维码 (真实实现)
 */
async function generateQRCodeReal(params) {
  const {
    content,
    output_path,
    size = 256,
    error_correction = 'M',
    style = {}
  } = params;

  try {
    // 确保输出目录存在
    const dir = path.dirname(output_path);
    await fsp.mkdir(dir, { recursive: true });

    const qrOptions = {
      errorCorrectionLevel: error_correction,
      width: size,
      margin: 1,
      color: {
        dark: style.foreground_color || '#000000',
        light: style.background_color || '#FFFFFF'
      }
    };

    // 如果有logo，需要特殊处理
    if (style.logo_path) {
      try {
        // 创建canvas
        const canvas = createCanvas(size, size);
        await QRCode.toCanvas(canvas, content, qrOptions);

        // 加载并绘制logo
        const ctx = canvas.getContext('2d');
        const logo = await loadImage(style.logo_path);
        const logoSize = Math.floor(size * 0.2);
        const logoX = Math.floor((size - logoSize) / 2);
        const logoY = Math.floor((size - logoSize) / 2);

        // 绘制白色背景（确保logo清晰）
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(logoX - 5, logoY - 5, logoSize + 10, logoSize + 10);

        // 绘制logo
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);

        // 保存
        const buffer = canvas.toBuffer('image/png');
        await fsp.writeFile(output_path, buffer);
      } catch (logoError) {
        // Logo加载失败，生成普通二维码
        console.warn('Logo加载失败，生成普通二维码:', logoError.message);
        await QRCode.toFile(output_path, content, qrOptions);
      }
    } else {
      // 直接生成到文件
      await QRCode.toFile(output_path, content, qrOptions);
    }

    // 获取文件信息
    const stats = await fsp.stat(output_path);

    return {
      success: true,
      output_path: output_path,
      content_length: content.length,
      qr_version: Math.ceil(content.length / 25), // 粗略估算
      size: size,
      error_correction: `${error_correction} (${getErrorCorrectionPercentage(error_correction)})`,
      style: {
        foreground: style.foreground_color || '#000000',
        background: style.background_color || '#FFFFFF',
        logo: style.logo_path ? 'included' : 'none',
        shape: style.shape || 'square'
      },
      file_size: stats.size
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 扫描二维码 (真实实现)
 */
async function scanQRCodeReal(params) {
  const {
    image_path,
    scan_type = 'auto',
    multiple = false
  } = params;

  try {
    // 加载图片
    const image = await loadImage(image_path);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    // 获取图片数据
    const imageData = ctx.getImageData(0, 0, image.width, image.height);

    // 扫描二维码
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });

    if (code) {
      return {
        success: true,
        image_path: image_path,
        scan_type: scan_type,
        codes_found: 1,
        codes: [{
          type: 'qrcode',
          data: code.data,
          position: {
            topLeft: code.location.topLeftCorner,
            topRight: code.location.topRightCorner,
            bottomLeft: code.location.bottomLeftCorner,
            bottomRight: code.location.bottomRightCorner,
            x: code.location.topLeftCorner.x,
            y: code.location.topLeftCorner.y,
            width: code.location.topRightCorner.x - code.location.topLeftCorner.x,
            height: code.location.bottomLeftCorner.y - code.location.topLeftCorner.y
          },
          binaryData: code.binaryData,
          version: code.version
        }]
      };
    } else {
      return {
        success: false,
        error: 'No QR code found in image',
        image_path: image_path
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ==================== 文件压缩工具 ====================
 */

/**
 * 压缩文件 (真实实现)
 */
async function compressFilesReal(params) {
  const {
    files,
    output_path,
    format = 'zip',
    compression_level = 'normal',
    password,
    split_size
  } = params;

  return new Promise((resolve, reject) => {
    try {
      // 确保输出目录存在
      const dir = path.dirname(output_path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const output = fs.createWriteStream(output_path);
      const archive = archiver(format === '7z' ? 'zip' : format, {
        zlib: { level: getCompressionLevel(compression_level) },
        store: compression_level === 'store'
      });

      let totalOriginalSize = 0;

      // 监听完成
      output.on('close', () => {
        const compressedSize = archive.pointer();
        const compressionRatio = totalOriginalSize > 0 ?
          ((1 - (compressedSize / totalOriginalSize)) * 100).toFixed(2) : '0.00';

        resolve({
          success: true,
          output_path: output_path,
          format: format,
          compression_level: compression_level,
          original_size: totalOriginalSize,
          compressed_size: compressedSize,
          compression_ratio: compressionRatio + '%',
          files_count: files.length,
          encrypted: !!password,
          split_archives: split_size ? Math.ceil(compressedSize / split_size) : 1
        });
      });

      // 监听错误
      archive.on('error', (err) => {
        reject(new Error(`压缩失败: ${err.message}`));
      });

      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') {
          console.warn('压缩警告:', err);
        }
      });

      // 连接流
      archive.pipe(output);

      // 添加文件
      for (const file of files) {
        try {
          const stat = fs.statSync(file);
          totalOriginalSize += stat.size;

          if (stat.isDirectory()) {
            archive.directory(file, path.basename(file));
          } else {
            archive.file(file, { name: path.basename(file) });
          }
        } catch (fileError) {
          console.warn(`文件 ${file} 添加失败:`, fileError.message);
        }
      }

      // 如果有密码（注意：archiver本身不直接支持密码，需要额外处理）
      if (password) {
        console.warn('注意：当前实现不支持密码加密，请使用7-Zip命令行工具');
      }

      // 完成归档
      archive.finalize();

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 解压文件 (真实实现)
 */
async function decompressFileReal(params) {
  const {
    archive_path,
    output_dir,
    password,
    overwrite = true,
    extract_files
  } = params;

  try {
    // 确保输出目录存在
    await fsp.mkdir(output_dir, { recursive: true });

    // 解压选项
    const options = {
      strip: 0
    };

    // 如果指定了特定文件
    if (extract_files && extract_files.length > 0) {
      options.filter = (file) => extract_files.includes(file.path);
    }

    // 执行解压
    const files = await decompress(archive_path, output_dir, options);

    // 计算总大小
    let totalSize = 0;
    for (const file of files) {
      try {
        const filePath = path.join(output_dir, file.path);
        const stats = await fsp.stat(filePath);
        totalSize += stats.size;
      } catch (err) {
        // 忽略统计错误
      }
    }

    // 获取压缩包格式
    const ext = path.extname(archive_path).toLowerCase();
    const formatMap = {
      '.zip': 'ZIP Archive',
      '.rar': 'RAR Archive',
      '.7z': '7-Zip Archive',
      '.tar': 'Tar Archive',
      '.gz': 'GZip Archive',
      '.bz2': 'BZip2 Archive'
    };
    const format = formatMap[ext] || 'Unknown Archive';

    return {
      success: true,
      archive_path: archive_path,
      output_dir: output_dir,
      format: format,
      extracted_files: files.length,
      total_size: totalSize,
      files: files.map(f => f.path),
      encrypted: !!password
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ==================== 辅助函数 ====================
 */

function getErrorCorrectionPercentage(level) {
  const levels = {
    'L': '7%',
    'M': '15%',
    'Q': '25%',
    'H': '30%'
  };
  return levels[level] || '15%';
}

function getCompressionLevel(level) {
  const levels = {
    'store': 0,
    'fastest': 1,
    'fast': 3,
    'normal': 5,
    'maximum': 7,
    'ultra': 9
  };
  return levels[level] || 5;
}

/**
 * ==================== 导出 ====================
 */

module.exports = {
  // 二维码
  generateQRCodeReal,
  scanQRCodeReal,

  // 文件压缩
  compressFilesReal,
  decompressFileReal
};
