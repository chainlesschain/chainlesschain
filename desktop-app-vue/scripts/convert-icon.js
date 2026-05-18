const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const convertIcon = async () => {
  const logoPath = path.join(__dirname, '../logo.png');
  const iconPath = path.join(__dirname, '../build/icon.ico');

  console.log('Converting PNG to ICO...');
  console.log('Source:', logoPath);
  console.log('Output:', iconPath);

  try {
    // png-to-ico 可能返回 default export
    const converter = pngToIco.default || pngToIco;
    const buf = await converter(logoPath);
    fs.writeFileSync(iconPath, buf);
    console.log('✓ Icon converted successfully!');
    console.log('Icon size:', buf.length, 'bytes');
  } catch (error) {
    console.error('✗ Conversion failed:', error);

    // 如果转换失败，使用简单的 PNG 复制
    console.log('Falling back to PNG format...');
    fs.copyFileSync(logoPath, iconPath.replace('.ico', '.png'));
    console.log('✓ PNG icon copied');
  }
};

convertIcon();
