
const API_URL = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/products`;

export async function getProducts() {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error("Products load nahi ho paaye.");
  }

  const data = await response.json();
  return data.products;
}
