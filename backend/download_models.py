#!/usr/bin/env python
"""
Pre-download HuggingFace models for offline use.
This script is run during Docker build to cache models in the image.
"""

import os
import sys

# Set HF cache directory to persist in image
os.environ['HF_HOME'] = '/app/.cache/huggingface'

print("=" * 60)
print("Pre-downloading HuggingFace models...")
print("=" * 60)

try:
    print("\n[1/2] Downloading embedding model: BAAI/bge-small-en-v1.5")
    from langchain_huggingface import HuggingFaceEmbeddings
    embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
    print("✓ Embedding model downloaded successfully")
except Exception as e:
    print(f"✗ Failed to download embedding model: {e}")
    sys.exit(1)

try:
    print("\n[2/2] Downloading reranker model: cross-encoder/ms-marco-MiniLM-L-6-v2")
    from sentence_transformers import CrossEncoder
    reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    print("✓ Reranker model downloaded successfully")
except Exception as e:
    print(f"✗ Failed to download reranker model: {e}")
    sys.exit(1)

print("\n" + "=" * 60)
print("All models downloaded successfully! ✓")
print("=" * 60)
