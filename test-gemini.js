require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
  console.log('❌ GEMINI_API_KEY belum diisi di file .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function main() {
  console.log('Testing Gemini API with key:', apiKey.slice(0, 8) + '...');
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Ping test! Balas Pong! jika aktif.'
    });
    console.log('✅ BERHASIL! Respons Gemini:');
    console.log(res.text);
  } catch (err) {
    console.error('❌ Gagal menghubungi Gemini API:', err.message);
  }
}

main();
