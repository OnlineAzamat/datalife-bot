import os
import chromadb
from chromadb.utils import embedding_functions
from dotenv import load_dotenv

load_dotenv()

chroma_dir = os.path.join(os.getcwd(), "chroma", "db")
client = chromadb.PersistentClient(path=chroma_dir)

openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=os.getenv("OPENAI_API_KEY"),
    model_name="text-embedding-3-small"
)

collection = client.get_or_create_collection(
    name="course_docs",
    embedding_function=openai_ef
)

def load_documents(folder="data"):
    documents = []
    metadatas = []
    ids = []

    for idx, filename in enumerate(os.listdir(folder)):
        filepath = os.path.join(folder, filename)
        if os.path.isfile(filepath) and filename.endswith(".txt"):
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
                documents.append(content)
                metadatas.append({"source": filename})
                ids.append(str(idx))
    
    collection.add(documents=documents, metadatas=metadatas, ids=ids)
    print(f"{len(documents)} ta fayl embedding qilindi.")

if __name__ == "__main__":
    load_documents()