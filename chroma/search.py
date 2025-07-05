import os
import chromadb
from chromadb.utils import embedding_functions
from dotenv import load_dotenv

load_dotenv()

# Chroma DB joylashuvi
chroma_dir = os.path.join(os.getcwd(), "chroma", "db")

# Chroma mijozini ishga tushirish
client = chromadb.PersistentClient(path=chroma_dir)

# Embedding funksiyasi
openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=os.getenv("OPENAI_API_KEY"),
    model_name="text-embedding-3-small"
)

# Kolleksiyani olish
collection = client.get_or_create_collection(
    name="course_docs",
    embedding_function=openai_ef
)

# 🔍 Qidiruv funksiyasi
def search_similar_documents(query_text, n_results=1):
    results = collection.query(
        query_texts=[query_text],
        n_results=n_results
    )

    documents = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    return list(zip(documents, metadatas, distances))


# 🔽 Test qilish uchun:
if __name__ == "__main__":
    query = input("Savolingizni kiriting: ")
    top_docs = search_similar_documents(query, n_results=2)

    print("\n🔍 Eng mos natijalar:")
    for i, (doc, meta, dist) in enumerate(top_docs, 1):
        print(f"\n{i}. Fayl: {meta['source']}")
        print(f"   Masofa: {dist:.4f}")
        print(f"   Matn:\n{doc}")