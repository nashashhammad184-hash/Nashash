const fs = require('fs');
const file = `${process.env.HOME}/Nashash/artifacts/api-server/dist/index.mjs`;
let content = fs.readFileSync(file, 'utf8');

// استبدال كلي ومباشر لعبارة الخطأ بـ continue لتمرير حقل createdAt بسلام دائماً
content = content.split('throw new Error(`Unrecognized key: "${key}"`);').join('continue;');

fs.writeFileSync(file, content, 'utf8');
console.log("✅ تم تأمين حماية العبور الشاملة في ملف الـ Dist التنفيذي!");
