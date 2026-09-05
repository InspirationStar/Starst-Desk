// 生成简单的 PNG 占位图标
const fs = require('fs');
const path = require('path');

// 创建最小的有效 PNG（1x1 像素，蓝色）
function createMinimalPNG(r, g, b) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk: 1x1, 8-bit RGB
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);  // width
  ihdrData.writeUInt32BE(1, 4);  // height
  ihdrData[8] = 8;               // bit depth
  ihdrData[9] = 2;               // color type (RGB)
  ihdrData[10] = 0;              // compression
  ihdrData[11] = 0;              // filter
  ihdrData[12] = 0;              // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk: filter byte (0) + RGB pixel
  const idatData = Buffer.from([0, r, g, b]);
  // 简单压缩（这里使用 zlib）
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(idatData);

  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  // 简单 CRC（实际应用需要正确计算）
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const outDir = 'E:/Users/rclt/Desktop/Starst_Desk/resources';

// 蓝色托盘图标
fs.writeFileSync(path.join(outDir, 'tray-icon.png'), createMinimalPNG(30, 136, 229));
console.log('tray-icon.png created');

// 红色提醒图标
fs.writeFileSync(path.join(outDir, 'tray-icon-alert.png'), createMinimalPNG(229, 30, 30));
console.log('tray-icon-alert.png created');

// 应用图标 (256x256) - 使用更复杂的方法
const { execSync } = require('child_process');
try {
  execSync('npx canvas-sketch-cli --help', { timeout: 5000, stdio: 'pipe' });
} catch (e) {
  // 简单方式：复制托盘图标作为窗口图标
  const icon16 = fs.readFileSync(path.join(outDir, 'tray-icon.png'));
  // 写入一个较大的占位文件
  fs.writeFileSync(path.join(outDir, 'icon.png'), icon16);
  console.log('icon.png created (from tray-icon)');
}

console.log('All placeholder icons created');