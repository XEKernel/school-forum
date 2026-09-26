const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { IMAGES_DIR, getUploadConfig } = require('../config/constants');

// multer 存储配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, IMAGES_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// 允许的扩展名 → mimetype 映射（强制扩展名与类型匹配，杜绝 html/svg 等危险文件落地）
const EXTENSION_MIME_MAP = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.bmp': ['image/bmp'],
  '.avif': ['image/avif'],
  '.heic': ['image/heic'],
  '.heif': ['image/heif']
};

// 动态文件过滤器 - 每次请求时获取最新配置
const fileFilter = (req, file, cb) => {
  const uploadConfig = getUploadConfig();
  const ext = path.extname(file.originalname || '').toLowerCase();
  const expectedMimes = EXTENSION_MIME_MAP[ext] || [];
  // 三重校验：扩展名在白名单 + mimetype 在配置允许列表 + 扩展名与 mimetype 匹配
  // 注意：SVG（image/svg+xml）不在映射表中，一律拒绝，防止脚本注入
  if (
    expectedMimes.length > 0 &&
    uploadConfig.allowedTypes.includes(file.mimetype) &&
    expectedMimes.includes(file.mimetype)
  ) {
    cb(null, true);
  } else {
    const err = new Error('只支持 JPG, PNG, GIF, WebP 格式的图片');
    err.statusCode = 400; // 文件类型错误属客户端错误，返回 400 而非 500
    cb(err, false);
  }
};

/**
 * 创建 multer 实例 - 使用最新的配置
 * 每次调用都会读取最新的配置，确保配置修改后立即生效
 * @returns {multer.Multer} multer 实例
 */
function createUploadMiddleware() {
  const uploadConfig = getUploadConfig();
  return multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: uploadConfig.maxFileSize,
      files: uploadConfig.maxFiles
    }
  });
}

// 创建默认的 multer 实例（向后兼容）
const upload = createUploadMiddleware();

/**
 * 净化上传文件原名
 * 落盘文件名始终是 UUID + 白名单扩展名，originalname 仅用于展示/记录；
 * 但它会被回传前端并入库，因此仍需去掉 HTML/JS/路径上下文有特殊含义的字符
 * @param {string} name - 原始文件名（客户端可任意构造）
 * @returns {string} - 净化后的文件名
 */
function sanitizeOriginalName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  return name
    .replace(/[<>"'`\\/\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100);
}

// 处理上传的文件信息
function processUploadedFiles(files) {
  if (!files || files.length === 0) {
    return [];
  }
  
  return files.map(file => ({
    id: uuidv4(),
    filename: file.filename,
    originalname: sanitizeOriginalName(file.originalname),
    size: file.size,
    mimetype: file.mimetype,
    url: `/images/${file.filename}`,
    uploadedAt: new Date().toISOString()
  }));
}

// ==================== 魔术字节（文件头）校验 ====================
// fileFilter 读的是客户端声明的 originalname 与 mimetype，两者都能伪造：
// 把任意内容改名成 .png 并声明 image/png 就能落盘。这里在落盘后读真实文件头，
// 命中不匹配即删除全部已上传文件并返回 400。
const MAGIC_HEAD_BYTES = 16;

const ISO_BMFF_BRANDS = ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevm', 'hevs', 'heis', 'mif1', 'msf1'];

const MAGIC_RULES = {
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.gif': (b) => {
    const sig = b.subarray(0, 6).toString('latin1');
    return sig === 'GIF87a' || sig === 'GIF89a';
  },
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.bmp': (b) => b[0] === 0x42 && b[1] === 0x4d,
  '.avif': (b) => isIsoBmff(b),
  '.heic': (b) => isIsoBmff(b),
  '.heif': (b) => isIsoBmff(b)
};

function isIsoBmff(buf) {
  if (buf.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
  return ISO_BMFF_BRANDS.includes(buf.subarray(8, 12).toString('latin1'));
}

async function readHead(filePath, length) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * 校验上传文件的真实类型（必须挂在 multer 之后）
 * 不匹配时删除本次请求已落盘的所有文件，避免残留孤立图片
 */
async function verifyImageMagicBytes(req, res, next) {
  const files = [...(Array.isArray(req.files) ? req.files : []), ...(req.file ? [req.file] : [])];
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      const ext = path.extname(file.filename || file.path || '').toLowerCase();
      const rule = MAGIC_RULES[ext];
      const head = await readHead(file.path, MAGIC_HEAD_BYTES);

      if (!rule || head.length < 12 || !rule(head)) {
        await Promise.all(files.map(f =>
          fs.promises.unlink(f.path).catch(() => {})
        ));
        return res.status(400).json({
          success: false,
          message: '图片内容与文件格式不符，请上传真实的 JPG/PNG/GIF/WebP 图片'
        });
      }
    }
    next();
  } catch (error) {
    await Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
    next(error);
  }
}

module.exports = {
  upload,
  createUploadMiddleware,
  processUploadedFiles,
  verifyImageMagicBytes
};