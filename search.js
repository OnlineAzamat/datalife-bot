// search.js
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Embedding olish
async function getEmbedding(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

// Kosinus o‘xshashlik hisoblash
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

// Barcha fayllarni embedding qilish
async function buildDatabase(folder = "data") {
  const files = fs.readdirSync(folder).filter(f => f.endsWith(".txt"));
  const db = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(folder, file), "utf-8");
    const embedding = await getEmbedding(content);
    db.push({ text: content, file, embedding });
    console.log(`✅ Embedding: ${file}`);
  }

  fs.writeFileSync("embedding_db.json", JSON.stringify(db, null, 2), "utf-8");
  console.log("🧠 Baza yaratildi → embedding_db.json");
}

// Eng mos matnni topish
async function search(query, topK = 1) {
  const queryEmbedding = await getEmbedding(query);
  const db = JSON.parse(fs.readFileSync("embedding_db.json", "utf-8"));

  const scored = db.map(entry => ({
    ...entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

// CLI test
if (require.main === module) {
  const mode = process.argv[2];

  if (mode === "build") {
    buildDatabase(); // → node search.js build
  } else if (mode === "query") {
    const query = process.argv.slice(3).join(" ");
    search(query).then(results => {
      console.log("\n🔍 Natijalar:");
      results.forEach((r, i) => {
        console.log(`\n${i + 1}. Fayl: ${r.file}`);
        console.log(`Score: ${r.score.toFixed(4)}`);
        console.log(`Matn:\n${r.text.slice(0, 300)}...`);
      });
    });
  } else {
    console.log("❌ Foydalanish: node search.js [build | query <savol>]");
  }
}

module.exports = { search };