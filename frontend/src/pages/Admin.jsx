import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Package,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  RefreshCw,
  Image as ImageIcon,
  Upload,
  IndianRupee,
  Boxes,
  AlertCircle,
  CheckCircle,
  LogOut,
} from "lucide-react";
import { Link } from "react-router-dom";
import "./Admin.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const API_URL = `${API_BASE_URL}/api/products`;
const IMAGE_UPLOAD_URL = `${API_BASE_URL}/api/images/upload`;
const LOGIN_URL = `${API_BASE_URL}/api/auth/login`;

const CATEGORIES = [
  "Mahadev",
  "Hanuman",
  "Om",
  "Rudraksha",
  "Men's Fashion",
  "Gold Finish",
  "Silver Finish",
  "Personalized",
  "Couple Pendants",
];

const EMPTY_FORM = {
  name: "",
  slug: "",
  description: "",
  price: "",
  originalPrice: "",
  category: "Mahadev",
  image: "",
  stock: "0",
};

function createSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatPrice(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function Admin() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");

  const [selectedImages, setSelectedImages] = useState([]);
  const [removedSavedImages, setRemovedSavedImages] = useState([]);

  // Token is deliberately kept in memory, not localStorage.
  // Refreshing the page will require the admin to log in again.
  const [token, setToken] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Derived from selectedImages: no separate state needed.
  const imagePreviews = useMemo(
    () => selectedImages.map((file) => URL.createObjectURL(file)),
    [selectedImages]
  );

  useEffect(() => {
    return () => imagePreviews.forEach((url) => URL.revokeObjectURL(url));
  }, [imagePreviews]);

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setSelectedImages([]);
    setRemovedSavedImages([]);
    setShowForm(false);
  }

  function logout() {
    setToken("");
    setLoginPassword("");
    setLoginError("");
    setError("");
    setMessage("");
    setProducts([]);
    setOrders([]);
    setOrdersError("");
    resetForm();
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");

    try {
      const response = await fetch(LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.token) {
        throw new Error(data.message || "Login nahi ho paaya.");
      }

      setToken(data.token);
      setLoginPassword("");
    } catch (err) {
      setLoginError(
        err.message || "Login nahi ho paaya. Backend server check karo."
      );
    } finally {
      setLoginLoading(false);
    }
  }

  const adminFetch = useCallback(
    async (url, options = {}) => {
      if (!token) {
        throw new Error("Pehle admin login karo.");
      }

      const response = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        setToken("");
        setProducts([]);
        setOrders([]);
        setLoginError("Session expire ho gaya. Dobara login karo.");
        setLoginPassword("");
        resetForm();
        throw new Error("Session expire ho gaya. Dobara login karo.");
      }

      return response;
    },
    [token]
  );

  const loadProducts = useCallback(async () => {
    if (!token) {
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Public read endpoint; token is also sent for consistency.
      const response = await adminFetch(API_URL);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Products load nahi ho paaye.");
      }

      setProducts(Array.isArray(data) ? data : data.products || []);
    } catch (err) {
      setError(
        err.message ||
          "Backend se connection nahi ho paaya. Backend server check karo."
      );
    } finally {
      setLoading(false);
    }
  }, [adminFetch, token]);

  useEffect(() => {
    if (!token) {
      setProducts([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      loadProducts();
    }, 0);

    return () => clearTimeout(timer);
  }, [token, loadProducts]);

  const loadOrders = useCallback(async () => {
    if (!token) {
      setOrders([]);
      setOrdersLoading(false);
      return;
    }

    setOrdersLoading(true);
    setOrdersError("");

    try {
      const response = await adminFetch(`${API_BASE_URL}/api/orders`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Orders load nahi ho paaye.");
      }

      setOrders(
        Array.isArray(data)
          ? data
          : Array.isArray(data.orders)
            ? data.orders
            : []
      );
    } catch (err) {
      setOrdersError(err.message || "Orders load nahi ho paaye.");
    } finally {
      setOrdersLoading(false);
    }
  }, [adminFetch, token]);

  const updateOrderStatus = useCallback(
    async (orderId, status) => {
      setUpdatingOrderId(orderId);
      setOrdersError("");

      try {
        const response = await adminFetch(
          `${API_BASE_URL}/api/orders/${orderId}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || "Order status update nahi hua.");
        }

        await loadOrders();
        setMessage(`Order status updated: ${status}`);
      } catch (err) {
        setOrdersError(err.message || "Order status update nahi hua.");
      } finally {
        setUpdatingOrderId("");
      }
    },
    [adminFetch, loadOrders]
  );

  useEffect(() => {
    if (!token) {
      setOrders([]);
      setOrdersLoading(false);
      setOrdersError("");
      return;
    }

    const timer = setTimeout(() => {
      loadOrders();
    }, 0);

    return () => clearTimeout(timer);
  }, [token, loadOrders]);

  const stats = useMemo(() => {
    const totalProducts = products.length;
    const totalStock = products.reduce(
      (total, product) => total + Number(product.stock || 0),
      0
    );
    const inventoryValue = products.reduce(
      (total, product) =>
        total + Number(product.price || 0) * Number(product.stock || 0),
      0
    );
    const lowStock = products.filter(
      (product) => Number(product.stock || 0) <= 5
    ).length;

    return { totalProducts, totalStock, inventoryValue, lowStock };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !query ||
        product.name?.toLowerCase().includes(query) ||
        product.slug?.toLowerCase().includes(query) ||
        product.category?.toLowerCase().includes(query);

      const matchesCategory =
        filterCategory === "All" || product.category === filterCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, filterCategory]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  function openAddForm() {
    setError("");
    setMessage("");
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setSelectedImages([]);
    setRemovedSavedImages([]);
    setShowForm(true);
  }

  function openEditForm(product) {
    setError("");
    setMessage("");
    setEditingId(product._id || product.id);

    setForm({
      name: product.name || "",
      slug: product.slug || "",
      description: product.description || "",
      price: String(product.price ?? ""),
      originalPrice:
        product.originalPrice == null ? "" : String(product.originalPrice),
      category: product.category || "Mahadev",
      image: product.image || "",
      stock: String(product.stock ?? 0),
    });

    setSelectedImages([]);
    setRemovedSavedImages([]);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleImageChange(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setError("");

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (selectedImages.length + files.length > 10) {
      setError("Ek product ke liye maximum 10 images select kar sakte ho.");
      event.target.value = "";
      return;
    }

    const invalid = files.find(
      (file) => !allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024
    );
    if (invalid) {
      setError(
        !allowedTypes.includes(invalid.type)
          ? "JPG, PNG, WebP ya GIF images select karo."
          : "Har image ka size 5 MB ya usse kam hona chahiye."
      );
      event.target.value = "";
      return;
    }

    setSelectedImages((previous) => [...previous, ...files]);
    event.target.value = "";
  }

  function removeSelectedImage(index) {
    setSelectedImages((previous) =>
      previous.filter((_, fileIndex) => fileIndex !== index)
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const currentProduct = products.find(
        (product) => (product._id || product.id) === editingId
      );
      let uploadedImages = Array.isArray(currentProduct?.images)
        ? [...currentProduct.images]
        : [];

      if (uploadedImages.length === 0 && currentProduct?.image) {
        uploadedImages = [currentProduct.image];
      }

      uploadedImages = uploadedImages.filter(
        (image) => !removedSavedImages.includes(image)
      );

      if (!currentProduct && form.image.trim()) {
        uploadedImages = [form.image.trim()];
      }

      if (selectedImages.length > 0) {
        const imageData = new FormData();
        selectedImages.forEach((file) => imageData.append("images", file));

        const uploadResponse = await adminFetch(IMAGE_UPLOAD_URL, {
          method: "POST",
          body: imageData,
        });
        const uploadResult = await uploadResponse.json().catch(() => ({}));

        if (!uploadResponse.ok) {
          throw new Error(
            uploadResult.message || "Images upload nahi ho paayi."
          );
        }

        const newlyUploaded = Array.isArray(uploadResult.images)
          ? uploadResult.images.map((item) => item.image)
          : uploadResult.image
            ? [uploadResult.image]
            : [];

        if (newlyUploaded.length !== selectedImages.length) {
          throw new Error("Sabhi images upload nahi ho paayi. Dobara try karo.");
        }

        uploadedImages = [...uploadedImages, ...newlyUploaded].slice(0, 10);
      }

      const uploadedImage = uploadedImages[0] || form.image.trim();

      const payload = {
        name: form.name.trim(),
        slug: createSlug(form.slug || form.name),
        description: form.description.trim(),
        price: Number(form.price),
        category: form.category,
        image: uploadedImage,
        images: uploadedImages,
        stock: Number(form.stock),
      };

      if (form.originalPrice !== "") {
        payload.originalPrice = Number(form.originalPrice);
      }

      const response = await adminFetch(
        editingId ? `${API_URL}/${editingId}` : API_URL,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Product save nahi ho paaya.");
      }

      setMessage(
        editingId
          ? "Product successfully update ho gaya."
          : "Product successfully add ho gaya."
      );
      resetForm();
      await loadProducts();
    } catch (err) {
      setError(err.message || "Request fail ho gayi. Backend check karo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product) {
    const confirmed = window.confirm(`"${product.name}" ko delete karna hai?`);
    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      const id = product._id || product.id;
      const response = await adminFetch(`${API_URL}/${id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Product delete nahi ho paaya.");
      }

      setMessage("Product delete ho gaya.");
      if (editingId === id) resetForm();
      await loadProducts();
    } catch (err) {
      setError(err.message || "Product delete karte waqt error aaya.");
    }
  }

  if (!token) {
    return (
      <main className="admin-login-page">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <div className="admin-login-icon">
            <Package size={28} />
          </div>
          <span className="admin-eyebrow">YOUR DIVINE STORE</span>
          <h1>Admin Login</h1>
          <p>Dashboard access karne ke liye sign in karo.</p>

          {loginError && (
            <div className="admin-alert admin-alert-error" role="alert">
              <AlertCircle size={18} />
              <span>{loginError}</span>
            </div>
          )}

          <label className="admin-field">
            <span>Admin Email</span>
            <input
              type="email"
              autoComplete="username"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="admin@example.com"
              required
            />
          </label>

          <label className="admin-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          <button
            type="submit"
            className="admin-primary-button admin-login-button"
            disabled={loginLoading}
          >
            {loginLoading ? "Signing in..." : "Sign In"}
          </button>

          <Link to="/" className="admin-back-link admin-login-back">
            <ArrowLeft size={16} />
            Back to store
          </Link>
        </form>
      </main>
    );
  }

  const editingProduct = editingId
    ? products.find((p) => (p._id || p.id) === editingId)
    : null;
  const savedImages = editingProduct
    ? (Array.isArray(editingProduct.images) && editingProduct.images.length
        ? editingProduct.images
        : editingProduct.image
          ? [editingProduct.image]
          : []
      ).filter((src) => !removedSavedImages.includes(src))
    : [];

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div className="admin-header-left">
          <Link to="/" className="admin-back-link">
            <ArrowLeft size={18} />
            <span>Store par wapas</span>
          </Link>

          <div className="admin-heading">
            <span className="admin-eyebrow">YOUR DIVINE STORE</span>
            <h1>Admin Dashboard</h1>
            <p>Products aur inventory manage karo.</p>
          </div>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-secondary-button"
            onClick={loadProducts}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Refresh
          </button>

          <button
            type="button"
            className="admin-primary-button"
            onClick={openAddForm}
          >
            <Plus size={17} />
            Add Product
          </button>

          <button
            type="button"
            className="admin-secondary-button"
            onClick={logout}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-alert admin-alert-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            type="button"
            aria-label="Error band karo"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {message && (
        <div className="admin-alert admin-alert-success" role="status">
          <CheckCircle size={18} />
          <span>{message}</span>
          <button
            type="button"
            aria-label="Message band karo"
            onClick={() => setMessage("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="admin-stats-grid" aria-label="Store statistics">
        <article className="admin-stat-card">
          <div className="admin-stat-icon">
            <Package size={21} />
          </div>
          <div>
            <p>Total Products</p>
            <h2>{stats.totalProducts}</h2>
          </div>
        </article>
        <article className="admin-stat-card">
          <div className="admin-stat-icon">
            <Boxes size={21} />
          </div>
          <div>
            <p>Total Stock</p>
            <h2>{stats.totalStock}</h2>
          </div>
        </article>
        <article className="admin-stat-card">
          <div className="admin-stat-icon">
            <IndianRupee size={21} />
          </div>
          <div>
            <p>Inventory Value</p>
            <h2>{formatPrice(stats.inventoryValue)}</h2>
          </div>
        </article>
        <article className="admin-stat-card">
          <div className="admin-stat-icon">
            <AlertCircle size={21} />
          </div>
          <div>
            <p>Low Stock Items</p>
            <h2>{stats.lowStock}</h2>
          </div>
        </article>
      </section>

      {showForm && (
        <section className="admin-form-section">
          <div className="admin-section-heading">
            <div>
              <h2>{editingId ? "Edit Product" : "Add New Product"}</h2>
              <p>Product ki details neeche bharo.</p>
            </div>
            <button
              type="button"
              className="admin-icon-button"
              onClick={resetForm}
              aria-label="Form band karo"
            >
              <X size={20} />
            </button>
          </div>

          <form className="admin-product-form" onSubmit={handleSubmit}>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Product Name *</span>
                <input
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  placeholder="Example: Mahadev Pendant"
                  required
                  maxLength={150}
                />
              </label>
              <label className="admin-field">
                <span>Product Slug</span>
                <input
                  name="slug"
                  value={form.slug}
                  onChange={updateField}
                  placeholder="Auto-generated from product name"
                />
              </label>
              <label className="admin-field">
                <span>Selling Price (₹) *</span>
                <input
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={updateField}
                  placeholder="499"
                  required
                />
              </label>
              <label className="admin-field">
                <span>Original Price (₹)</span>
                <input
                  name="originalPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.originalPrice}
                  onChange={updateField}
                  placeholder="799"
                />
              </label>
              <label className="admin-field">
                <span>Category *</span>
                <select
                  name="category"
                  value={form.category}
                  onChange={updateField}
                  required
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Stock Quantity *</span>
                <input
                  name="stock"
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={updateField}
                  required
                />
              </label>
              <label className="admin-field admin-field-full">
                <span>Description</span>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateField}
                  placeholder="Product ki details likho..."
                  rows={4}
                />
              </label>

              <div className="admin-field admin-field-full">
                <span>Product Images (maximum 10)</span>
                <label className="admin-image-upload">
                  <Upload size={20} />
                  <span>Ek ya multiple images choose karo</span>
                  <small>JPG, PNG, WebP ya GIF · Har image maximum 5 MB</small>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={handleImageChange}
                  />
                </label>

                <label className="admin-field admin-image-url-field">
                  <span>Ya primary image URL paste karo</span>
                  <input
                    name="image"
                    type="url"
                    value={form.image}
                    onChange={updateField}
                    placeholder="https://example.com/product.jpg"
                  />
                </label>

                <div className="admin-multi-image-preview">
                  {form.image && selectedImages.length === 0 && (
                    <div className="admin-image-preview">
                      <img src={form.image} alt="Primary product preview" />
                      <small>Primary image URL</small>
                    </div>
                  )}

                  {imagePreviews.map((src, index) => (
                    <div
                      className="admin-image-preview"
                      key={`${src}-${index}`}
                    >
                      <img src={src} alt={`Selected product ${index + 1}`} />
                      <button
                        type="button"
                        className="admin-remove-image"
                        onClick={() => removeSelectedImage(index)}
                      >
                        <X size={15} /> Remove
                      </button>
                    </div>
                  ))}

                  {savedImages.map((src, index) => (
                    <div
                      className="admin-image-preview"
                      key={`saved-${src}-${index}`}
                    >
                      <img src={src} alt={`Saved product ${index + 1}`} />
                      <small>Already saved</small>
                      <button
                        type="button"
                        className="admin-remove-image"
                        onClick={() =>
                          setRemovedSavedImages((previous) => [
                            ...previous,
                            src,
                          ])
                        }
                        disabled={saving}
                      >
                        <X size={15} /> Remove image
                      </button>
                    </div>
                  ))}

                  {!form.image &&
                    imagePreviews.length === 0 &&
                    savedImages.length === 0 && (
                      <div className="admin-image-placeholder">
                        <ImageIcon size={28} />
                        <span>Image previews yahan dikhenge</span>
                      </div>
                    )}
                </div>
              </div>
            </div>

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-secondary-button"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="admin-primary-button"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <RefreshCw size={16} className="admin-spinning" /> Saving...
                  </>
                ) : (
                  <>
                    {editingId ? <Pencil size={16} /> : <Plus size={17} />}
                    {editingId ? "Update Product" : "Save Product"}
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Orders Management */}
      <section className="admin-orders-section">
        <div className="admin-section-heading">
          <div>
            <h2>Customer Orders</h2>
            <p>{orders.length} orders received</p>
          </div>

          <button
            type="button"
            className="admin-secondary-button"
            onClick={loadOrders}
            disabled={ordersLoading}
          >
            <RefreshCw
              size={16}
              className={ordersLoading ? "admin-spin" : ""}
            />
            {ordersLoading ? "Refreshing..." : "Refresh Orders"}
          </button>
        </div>

        {ordersError && (
          <div className="admin-alert admin-alert-error" role="alert">
            <AlertCircle size={18} />
            <span>{ordersError}</span>
          </div>
        )}

        {ordersLoading && orders.length === 0 ? (
          <div className="admin-orders-empty">
            <RefreshCw size={24} className="admin-spin" />
            <p>Loading orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="admin-orders-empty">
            <Package size={30} />
            <h3>No orders yet</h3>
            <p>Customer ke COD orders yahan dikhai denge.</p>
          </div>
        ) : (
          <div className="admin-orders-list">
            {orders.map((order) => {
              const orderId = order._id || order.id || order.orderNumber;
              const currentStatus = order.status || "Placed";

              const nextStatuses = {
                Placed: ["Confirmed", "Cancelled"],
                Confirmed: ["Shipped", "Cancelled"],
                Shipped: ["Delivered"],
                Delivered: [],
                Cancelled: [],
              };

              const availableStatuses =
                nextStatuses[currentStatus] || [];

              const customerDetails = order.customer || {};
              const shipping = order.shippingAddress || {};
              const orderItems = Array.isArray(order.items)
                ? order.items
                : [];

              const addressText = [
                shipping.address,
                shipping.city,
                shipping.state,
                shipping.pincode,
                shipping.country,
              ]
                .filter(Boolean)
                .join(", ");

              return (
                <article className="admin-order-card" key={orderId}>
                  <div className="admin-order-top">
                    <div>
                      <span className="admin-order-label">
                        ORDER NUMBER
                      </span>
                      <h3>{order.orderNumber || String(orderId)}</h3>
                      <p className="admin-order-date">
                        {order.createdAt
                          ? new Date(order.createdAt).toLocaleString(
                              "en-IN",
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }
                            )
                          : "Date unavailable"}
                      </p>
                    </div>

                    <span
                      className={`admin-order-status status-${currentStatus.toLowerCase()}`}
                    >
                      {currentStatus}
                    </span>
                  </div>

                  <div className="admin-order-details">
                    <div className="admin-order-detail">
                      <h4>Customer</h4>
                      <p>{customerDetails.name || "N/A"}</p>
                      <p>{customerDetails.phone || "N/A"}</p>
                      {customerDetails.email && (
                        <p className="admin-order-break">
                          {customerDetails.email}
                        </p>
                      )}
                    </div>

                    <div className="admin-order-detail">
                      <h4>Delivery Address</h4>
                      <p>{addressText || "Address unavailable"}</p>
                    </div>
                  </div>

                  <div className="admin-order-items">
                    <h4>Items Ordered</h4>

                    {orderItems.map((item, index) => (
                      <div
                        className="admin-order-item"
                        key={
                          item._id ||
                          item.productId ||
                          `${orderId}-item-${index}`
                        }
                      >
                        <span>
                          {item.name || item.title || "Product"} ×{" "}
                          {Number(item.quantity || 1)}
                        </span>

                        <span>
                          ₹
                          {(
                            Number(item.price || 0) *
                            Number(item.quantity || 1)
                          ).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="admin-order-bottom">
                    <div>
                      <p className="admin-order-payment">
                        Payment: {order.paymentMethod || "COD"}
                      </p>
                      <span className="admin-order-total-label">
                        Order Total
                      </span>
                      <strong className="admin-order-total">
                        ₹
                        {Number(order.totalAmount || 0).toLocaleString(
                          "en-IN"
                        )}
                      </strong>
                    </div>

                    <div className="admin-order-actions">
                      {availableStatuses.length > 0 ? (
                        <>
                          <label htmlFor={`status-${orderId}`}>
                            Update status
                          </label>

                          <select
                            id={`status-${orderId}`}
                            value=""
                            disabled={updatingOrderId === orderId}
                            onChange={(event) => {
                              const nextStatus = event.target.value;
                              if (nextStatus) {
                                updateOrderStatus(orderId, nextStatus);
                              }
                            }}
                          >
                            <option value="">Select status</option>
                            {availableStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>

                          {updatingOrderId === orderId && (
                            <span className="admin-order-updating">
                              Updating...
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="admin-order-final">
                          {currentStatus === "Delivered"
                            ? "Order completed"
                            : currentStatus === "Cancelled"
                              ? "Order cancelled"
                              : "No status changes available"}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>


      <section className="admin-inventory-section">
        <div className="admin-section-heading">
          <div>
            <h2>Product Inventory</h2>
            <p>{filteredProducts.length} products found</p>
          </div>
        </div>

        <div className="admin-toolbar">
          <label className="admin-search-box">
            <Search size={18} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products..."
            />
          </label>
          <select
            className="admin-category-filter"
            value={filterCategory}
            onChange={(event) => setFilterCategory(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="admin-empty-state">
            <RefreshCw size={28} className="admin-spinning" />
            <p>Products load ho rahe hain...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="admin-empty-state">
            <Package size={32} />
            <h3>No products found</h3>
            <p>
              {products.length === 0
                ? "Abhi koi product add nahi hua hai."
                : "Search ya category filter change karke dekho."}
            </p>
            {products.length === 0 && (
              <button
                type="button"
                className="admin-primary-button"
                onClick={openAddForm}
              >
                <Plus size={17} /> Add First Product
              </button>
            )}
          </div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const productId = product._id || product.id;
                  const stock = Number(product.stock || 0);
                  return (
                    <tr key={productId}>
                      <td>
                        <div className="admin-product-cell">
                          <div className="admin-product-thumbnail">
                            {product.image ? (
                              <img
                                src={product.image}
                                alt={product.name}
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon size={22} />
                            )}
                          </div>
                          <div className="admin-product-info">
                            <strong>{product.name}</strong>
                            <span>{product.slug}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="admin-category-badge">
                          {product.category}
                        </span>
                      </td>
                      <td>
                        <div className="admin-price-cell">
                          <strong>{formatPrice(product.price)}</strong>
                          {product.originalPrice != null && (
                            <del>{formatPrice(product.originalPrice)}</del>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`admin-stock-badge ${
                            stock <= 5 ? "admin-stock-low" : "admin-stock-good"
                          }`}
                        >
                          {stock} units
                        </span>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-icon-button"
                            onClick={() => openEditForm(product)}
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            type="button"
                            className="admin-icon-button admin-delete-button"
                            onClick={() => deleteProduct(product)}
                            title="Delete product"
                            aria-label={`Delete ${product.name}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}