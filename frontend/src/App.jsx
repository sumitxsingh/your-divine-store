import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  ShoppingBag,
  Menu,
  X,
  ArrowRight,
  Heart,
  Truck,
  ShieldCheck,
  RefreshCw,
  Minus,
  Plus,
} from "lucide-react";

import { getProducts } from "./services/productService";
import "./App.css";

const categories = [
  "All Pendants",
  "Religious",
  "Men's Fashion",
  "Gold Finish",
  "Silver Finish",
  "Rudraksha",
  "Couple",
  "Personalized",
];

const CART_KEY = "yds-cart";
const WISHLIST_KEY = "yds-wishlist";

const EMPTY_CUSTOMER = {
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
};

function readStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function formatPrice(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatProduct(product) {
  return {
    ...product,
    id: product._id || product.id,
    price: Number(product.price) || 0,
    stock: Math.max(0, Number(product.stock) || 0),
    oldPrice: Number(product.originalPrice ?? product.price),
    image: product.image || product.images?.[0] || "",
    images: Array.isArray(product.images) ? product.images : [],
    tag: product.tag || "",
  };
}

function ProductImage({ image, name, images = [] }) {
  const availableImages = [
    ...new Set(
      [image, ...(Array.isArray(images) ? images : [])].filter(
        (item) => typeof item === "string" && item.trim()
      )
    ),
  ];

  const [selectedImage, setSelectedImage] = useState(
    availableImages[0] || ""
  );
  const [failedImages, setFailedImages] = useState([]);

  const imageSrc = (value) => {
    if (!value) return "";

    return value.startsWith("http")
      ? value
      : `/${value.replace(/^\/+/, "")}`;
  };

  const currentImageSrc = imageSrc(selectedImage);
  const imageFailed = failedImages.includes(currentImageSrc);

  return (
    <div className="product-image-gallery">
      <div className="product-image">
        {currentImageSrc && !imageFailed ? (
          <img
            src={currentImageSrc}
            alt={name}
            loading="lazy"
            onError={() => {
              setFailedImages((previous) =>
                previous.includes(currentImageSrc)
                  ? previous
                  : [...previous, currentImageSrc]
              );
            }}
          />
        ) : (
          <div className="image-placeholder">
            <ShoppingBag size={30} />
            <span>Product image coming soon</span>
          </div>
        )}
      </div>

      <div
        className="product-image-thumbnails"
        aria-label={`${name} images`}
      >
        {availableImages.length > 1 ? (
          availableImages.map((item, index) => {
            const thumbnailSrc = imageSrc(item);

            return (
              <button
                type="button"
                key={`${item}-${index}`}
                className={
                  selectedImage === item
                    ? "product-image-thumbnail active"
                    : "product-image-thumbnail"
                }
                onClick={() => setSelectedImage(item)}
                aria-label={`View image ${index + 1} of ${name}`}
                aria-pressed={selectedImage === item}
              >
                <img src={thumbnailSrc} alt="" loading="lazy" />
              </button>
            );
          })
        ) : (
          <span className="thumbnail-placeholder" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [category, setCategory] = useState("All Pendants");
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState(() => {
    const savedCart = readStorage(CART_KEY, []);
    return Array.isArray(savedCart) ? savedCart : [];
  });

  const [wishlist, setWishlist] = useState(() => {
    const savedWishlist = readStorage(WISHLIST_KEY, []);
    return Array.isArray(savedWishlist) ? savedWishlist : [];
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [checkoutError, setCheckoutError] = useState("");
  const [placedOrder, setPlacedOrder] = useState(null);

  const [customer, setCustomer] = useState({ ...EMPTY_CUSTOMER });

  const showNotice = useCallback((message) => {
    setNotice(message);
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const data = await getProducts();

      if (!Array.isArray(data)) {
        throw new Error("Products ka response sahi format mein nahi hai.");
      }

      setProducts(data.map(formatProduct));
      setProductError("");
    } catch (error) {
      setProductError(error.message || "Products load nahi ho paaye.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProducts();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  useEffect(() => {
    if (!notice) return undefined;

    const timer = window.setTimeout(() => {
      setNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (error) {
      console.warn("Cart browser mein save nahi ho paaya.", error);
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
    } catch (error) {
      console.warn("Wishlist browser mein save nahi ho paayi.", error);
    }
  }, [wishlist]);

  const filteredProducts = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return products.filter((product) => {
      const productCategory = (product.category || "").toLowerCase();

      const selectedCategory = category.toLowerCase();

      const matchesCategory =
        category === "All Pendants" ||
        productCategory === selectedCategory ||
        (category === "Religious" &&
          ["mahadev", "hanuman", "om"].includes(productCategory)) ||
        (category === "Couple" && productCategory.includes("couple"));

      const matchesSearch =
        (product.name || "").toLowerCase().includes(searchTerm) ||
        productCategory.includes(searchTerm) ||
        (product.description || "").toLowerCase().includes(searchTerm);

      return matchesCategory && matchesSearch;
    });
  }, [products, category, search]);

  const cartCount = cart.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const cartTotal = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );

  function addToCart(product) {
    if (product.stock <= 0) {
      showNotice("This product is currently out of stock.");
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);

    if (existingItem && Number(existingItem.quantity) >= product.stock) {
      showNotice("Maximum available stock already added.");
      return;
    }

    setCart((previous) => {
      const found = previous.find((item) => item.id === product.id);

      if (found) {
        return previous.map((item) =>
          item.id === product.id
            ? {
                ...item,
                ...product,
                quantity: Math.min(
                  Number(item.quantity || 0) + 1,
                  product.stock
                ),
              }
            : item
        );
      }

      return [...previous, { ...product, quantity: 1 }];
    });

    showNotice(`${product.name} added to your bag.`);
  }

  function toggleWishlist(id) {
    const alreadySaved = wishlist.includes(id);

    setWishlist((previous) =>
      alreadySaved
        ? previous.filter((item) => item !== id)
        : [...previous, id]
    );

    showNotice(
      alreadySaved ? "Removed from your wishlist." : "Added to your wishlist."
    );
  }

  function removeFromCart(id) {
    setCart((previous) => previous.filter((item) => item.id !== id));

    showNotice("Product removed from your bag.");
  }

  function updateCartQuantity(id, change) {
    const item = cart.find((product) => product.id === id);

    if (!item) return;

    const nextQuantity = Number(item.quantity || 0) + change;

    if (nextQuantity <= 0) {
      removeFromCart(id);
      return;
    }

    if (nextQuantity > Number(item.stock)) {
      showNotice("Available stock se zyada quantity nahi add kar sakte.");
      return;
    }

    setCart((previous) =>
      previous.map((product) =>
        product.id === id ? { ...product, quantity: nextQuantity } : product
      )
    );
  }

  function selectCategory(value) {
    setCategory(value);
    setMenuOpen(false);
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    setMenuOpen(false);
  }

  function handleCheckout() {
    if (cart.length === 0) {
      showNotice("Your shopping bag is empty.");
      return;
    }

    setCheckoutError("");
    setPlacedOrder(null);
    setCheckoutOpen(true);
  }

  async function submitOrder(event) {
    event.preventDefault();
    setCheckoutError("");

    if (checkoutLoading) return;

    setCheckoutLoading(true);

    const apiBase =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

    const orderPayload = {
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email.trim(),
      },
      shippingAddress: {
        address: customer.address.trim(),
        city: customer.city.trim(),
        state: customer.state.trim(),
        pincode: customer.pincode.trim(),
        country: "India",
      },
      items: cart.map((item) => ({
        productId: item.id,
        quantity: Number(item.quantity),
      })),
    };

    try {
      if (paymentMethod === "COD") {
        const response = await fetch(`${apiBase}/api/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...orderPayload,
            paymentMethod: "COD",
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message || data.error || "Order place nahi ho paaya."
          );
        }

        setPlacedOrder(data.order);
        setCart([]);
        setCheckoutOpen(false);
        setCustomer({ ...EMPTY_CUSTOMER });
        setCheckoutLoading(false);
        return;
      }

      // Load Razorpay Checkout only when the customer chooses online payment.
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const existingScript = document.querySelector(
            'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
          );

          if (existingScript) {
            existingScript.addEventListener("load", resolve, { once: true });
            existingScript.addEventListener(
              "error",
              () => reject(new Error("Razorpay Checkout load nahi hua.")),
              { once: true }
            );

            if (window.Razorpay) resolve();
            return;
          }

          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.async = true;
          script.onload = resolve;
          script.onerror = () =>
            reject(new Error("Razorpay Checkout load nahi hua."));
          document.body.appendChild(script);
        });
      }

      const createResponse = await fetch(
        `${apiBase}/api/payments/create-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...orderPayload,
            paymentMethod: "Razorpay",
          }),
        }
      );

      const created = await createResponse.json().catch(() => ({}));

      if (!createResponse.ok) {
        throw new Error(
          created.message || created.error || "Payment order create nahi hua."
        );
      }

      if (!window.Razorpay) {
        throw new Error("Razorpay Checkout available nahi hai. Please retry.");
      }

      const options = {
        key: created.keyId,
        amount: created.amount,
        currency: created.currency || "INR",
        name: "Your Divine Store",
        description: `Order ${created.orderNumber}`,
        order_id: created.razorpayOrderId,
        prefill: {
          name: customer.name.trim(),
          email: customer.email.trim(),
          contact: customer.phone.trim(),
        },
        theme: { color: "#8b6b3f" },

        handler: async (paymentResponse) => {
          try {
            setCheckoutError("");

            const verifyResponse = await fetch(
              `${apiBase}/api/payments/verify`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId: created.orderId,
                  razorpay_order_id: paymentResponse.razorpay_order_id,
                  razorpay_payment_id: paymentResponse.razorpay_payment_id,
                  razorpay_signature: paymentResponse.razorpay_signature,
                }),
              }
            );

            const verified = await verifyResponse.json().catch(() => ({}));

            if (!verifyResponse.ok) {
              throw new Error(
                verified.message ||
                  verified.error ||
                  "Payment verify nahi ho paaya. Order status check karein."
              );
            }

            setPlacedOrder(
              verified.order || {
                _id: created.orderId,
                orderNumber: created.orderNumber,
                totalAmount: Number(created.amount || 0) / 100,
                paymentMethod: "Razorpay",
                paymentStatus: "Paid",
              }
            );
            setCart([]);
            setCheckoutOpen(false);
            setCustomer({ ...EMPTY_CUSTOMER });
          } catch (error) {
            setCheckoutError(
              `${error.message} Agar paise deduct hue hain, dobara payment karne se pehle order status check karein.`
            );
          } finally {
            setCheckoutLoading(false);
          }
        },

        modal: {
          ondismiss: () => {
            setCheckoutLoading(false);
            setCheckoutError(
              "Payment window band ho gayi. Aap cart se dobara try kar sakte hain."
            );
          },
        },
      };

      const razorpay = new window.Razorpay(options);

      razorpay.on("payment.failed", (failure) => {
        setCheckoutError(
          failure.error?.description || "Payment fail ho gaya. Please retry."
        );
        setCheckoutLoading(false);
      });

      razorpay.open();
    } catch (error) {
      setCheckoutError(
        error.message || "Server se connection nahi ho paaya. Please try again."
      );
      setCheckoutLoading(false);
    }
  }

  return (
    <div className="store">
      <div className="announcement">
        A little divine, a little extraordinary.
        <span> Free shipping on eligible orders</span>
      </div>

      <header className="header">
        <button
          type="button"
          className="icon-button mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>

        <a
          className="brand"
          href="#home"
          aria-label="Your Divine Store home"
          onClick={() => setMenuOpen(false)}
        >
          <img
            src="/images/your-divine-store-logo.png"
            alt="Your Divine Store"
            className="brand-logo"
          />
        </a>

        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#home" onClick={() => setMenuOpen(false)}>
            Home
          </a>

          <a href="#shop" onClick={() => setMenuOpen(false)}>
            Shop All
          </a>

          <a href="#shop" onClick={() => selectCategory("Religious")}>
            Religious
          </a>

          <a href="#shop" onClick={() => selectCategory("Men's Fashion")}>
            Men's Collection
          </a>

          <a href="#why-us" onClick={() => setMenuOpen(false)}>
            Our Promise
          </a>
        </nav>

        <div className="header-actions">
          <label className="header-search">
            <Search size={18} />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => scrollToSection("shop")}
              placeholder="Search pendants"
              aria-label="Search products"
            />
          </label>

          <button
            type="button"
            className="icon-button bag-button"
            aria-label={`Shopping bag, ${cartCount} items`}
            onClick={() => scrollToSection("cart")}
          >
            <ShoppingBag size={21} />
            <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-line" />
              YOUR STORY. YOUR SYMBOL.
            </span>

            <h1>
              Wear what
              <br />
              you <em>believe in.</em>
            </h1>

            <p>
              Meaningful pendants for every belief, every style and every
              story. Find a piece that feels like you.
            </p>

            <a className="primary-button" href="#shop">
              Explore the collection <ArrowRight size={17} />
            </a>

            <div className="hero-note">
              <span>✧ Thoughtfully selected</span>
              <span>✧ Made to gift</span>
            </div>
          </div>

          <div className="hero-visual">
            <img
              src="https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1100&q=90"
              alt="Pendant jewellery collection"
            />

            <div className="hero-stamp">
              <span>MEANINGFUL</span>
              <strong>by design</strong>
              <span>✳</span>
            </div>

            <div className="hero-caption">
              <span>THE EVERYDAY COLLECTION</span>
              <strong>Small details. Lasting meaning.</strong>
            </div>
          </div>
        </section>

        <section className="benefits" id="why-us">
          <div>
            <Truck />
            <span>
              <strong>Shipping options</strong>
              <small>At checkout</small>
            </span>
          </div>

          <div>
            <ShieldCheck />
            <span>
              <strong>Secure payments</strong>
              <small>Payment protection</small>
            </span>
          </div>

          <div>
            <RefreshCw />
            <span>
              <strong>Support when needed</strong>
              <small>We're here to help</small>
            </span>
          </div>
        </section>

        <section className="shop-section" id="shop">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FIND YOUR SIGNATURE</span>
              <h2>
                Pieces with <em>meaning.</em>
              </h2>
              <p>From everyday essentials to pieces close to your heart.</p>
            </div>

            <span className="product-total">
              {loading ? "Loading..." : `${filteredProducts.length} products`}
            </span>
          </div>

          <div className="category-list">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                className={
                  category === item ? "category-chip active" : "category-chip"
                }
                onClick={() => selectCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>

          {loading && <div className="empty-state">Loading pendants...</div>}

          {!loading && productError && (
            <div className="empty-state" role="alert">
              <p>{productError}</p>

              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setLoading(true);
                  setProductError("");
                  void loadProducts();
                }}
              >
                Try again <ArrowRight size={15} />
              </button>
            </div>
          )}

          {!loading && !productError && (
            <>
              <div className="product-grid">
                {filteredProducts.map((product) => {
                  const oldPrice = Number(product.oldPrice);
                  const price = Number(product.price);

                  const discount =
                    oldPrice > price && oldPrice > 0
                      ? Math.round((1 - price / oldPrice) * 100)
                      : 0;

                  const cartItem = cart.find((item) => item.id === product.id);
                  const quantityInCart = Number(cartItem?.quantity || 0);
                  const isWished = wishlist.includes(product.id);

                  return (
                    <article className="product-card" key={product.id}>
                      <div className="product-photo-wrap">
                        <ProductImage
                          key={`${product.id}-${product.images.join("|")}`}
                          image={product.image}
                          images={product.images}
                          name={product.name}
                        />

                        {product.tag && (
                          <span className="product-tag">{product.tag}</span>
                        )}

                        <button
                          type="button"
                          className={
                            isWished
                              ? "wishlist-button wished"
                              : "wishlist-button"
                          }
                          onClick={() => toggleWishlist(product.id)}
                          aria-label={
                            isWished
                              ? `Remove ${product.name} from wishlist`
                              : `Add ${product.name} to wishlist`
                          }
                        >
                          <Heart
                            size={18}
                            fill={isWished ? "currentColor" : "none"}
                          />
                        </button>

                        <button
                          type="button"
                          className="quick-add"
                          onClick={() => addToCart(product)}
                          disabled={
                            product.stock <= 0 ||
                            quantityInCart >= product.stock
                          }
                        >
                          {product.stock <= 0
                            ? "Out of stock"
                            : quantityInCart >= product.stock
                              ? "Maximum in bag"
                              : "Add to bag"}
                          <ArrowRight size={15} />
                        </button>
                      </div>

                      <div className="product-info">
                        <span className="product-category">
                          {product.category}
                        </span>

                        <h3>{product.name}</h3>

                        <div className="product-prices">
                          <strong>{formatPrice(price)}</strong>

                          {oldPrice > price && (
                            <>
                              <del>{formatPrice(oldPrice)}</del>
                              {discount > 0 && <span>{discount}% OFF</span>}
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {filteredProducts.length === 0 && (
                <div className="empty-state">
                  No pendants found. Try another search or category.
                </div>
              )}
            </>
          )}
        </section>

        <section className="story-banner">
          <div className="story-symbol">✳</div>
          <span className="eyebrow">MORE THAN AN ACCESSORY</span>

          <h2>
            Some things you wear.
            <br />
            <em>Some things you carry.</em>
          </h2>

          <p>
            Discover pendants that celebrate your identity, your faith and the
            people who matter.
          </p>

          <a href="#shop" className="text-link">
            Find your pendant <ArrowRight size={16} />
          </a>
        </section>

        <section className="cart-section" id="cart">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR SELECTION</span>
              <h2>Your shopping bag.</h2>
            </div>

            <span className="product-total">{cartCount} items</span>
          </div>

          {placedOrder && (
            <div className="order-success" role="status">
              <ShieldCheck size={38} />
              <h3>Thank you for your order!</h3>
              <p>Your order has been placed successfully.</p>

              <div className="order-success-details">
                <span>Order number</span>
                <strong>{placedOrder.orderNumber}</strong>

                <span>Total amount</span>
                <strong>{formatPrice(placedOrder.totalAmount)}</strong>

                <span>Payment method</span>
                <strong>
                  {placedOrder.paymentMethod === "Razorpay"
                    ? "Online payment (Razorpay)"
                    : "Cash on Delivery"}
                </strong>

                <span>Order status</span>
                <strong>
                  {placedOrder.status || placedOrder.paymentStatus || "Placed"}
                </strong>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setPlacedOrder(null);
                  document.getElementById("shop")?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
              >
                Continue shopping <ArrowRight size={17} />
              </button>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="empty-cart">
              <ShoppingBag size={27} />
              <p>Your bag is waiting for something meaningful.</p>
              <a href="#shop" className="text-link">
                Explore pendants <ArrowRight size={16} />
              </a>
            </div>
          ) : (
            <div className="cart-content">
              {cart.map((item) => (
                <div className="cart-item" key={item.id}>
                  <ProductImage
                    key={`${item.id}-${item.image}`}
                    image={item.image}
                    name={item.name}
                  />

                  <div className="cart-item-details">
                    <strong>{item.name}</strong>

                    <span>
                      {formatPrice(item.price)} × {item.quantity}
                    </span>

                    <div className="cart-quantity">
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(item.id, -1)}
                        aria-label={`Decrease ${item.name} quantity`}
                      >
                        <Minus size={14} />
                      </button>

                      <span>{item.quantity}</span>

                      <button
                        type="button"
                        onClick={() => updateCartQuantity(item.id, 1)}
                        disabled={item.quantity >= Number(item.stock)}
                        aria-label={`Increase ${item.name} quantity`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="remove-button"
                      onClick={() => removeFromCart(item.id)}
                    >
                      Remove
                    </button>
                  </div>

                  <strong>
                    {formatPrice(Number(item.price) * Number(item.quantity))}
                  </strong>
                </div>
              ))}

              <div className="cart-total">
                <span>Subtotal</span>
                <strong>{formatPrice(cartTotal)}</strong>
              </div>

              <button
                type="button"
                className="primary-button checkout-button"
                onClick={handleCheckout}
              >
                Proceed to checkout <ArrowRight size={17} />
              </button>

              <p className="checkout-note">
                Shipping and payment options will be calculated at checkout.
              </p>
            </div>
          )}

          {checkoutOpen && cart.length > 0 && (
            <form className="checkout-form" onSubmit={submitOrder}>
              <div className="checkout-heading">
                <span className="eyebrow">DELIVERY DETAILS</span>
                <h3>Where should we deliver?</h3>
                <p>Enter your details to place your order.</p>
              </div>

              <div className="checkout-grid">
                <label>
                  Full name *
                  <input
                    type="text"
                    value={customer.name}
                    onChange={(e) =>
                      setCustomer({ ...customer, name: e.target.value })
                    }
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    required
                    placeholder="Enter your full name"
                  />
                </label>

                <label>
                  Mobile number *
                  <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) =>
                      setCustomer({
                        ...customer,
                        phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                      })
                    }
                    pattern="[6-9][0-9]{9}"
                    maxLength={10}
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                    placeholder="10-digit mobile number"
                  />
                </label>

                <label className="checkout-full-width">
                  Email address (optional)
                  <input
                    type="email"
                    value={customer.email}
                    onChange={(e) =>
                      setCustomer({ ...customer, email: e.target.value })
                    }
                    maxLength={254}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="checkout-full-width">
                  Full delivery address *
                  <textarea
                    value={customer.address}
                    onChange={(e) =>
                      setCustomer({ ...customer, address: e.target.value })
                    }
                    minLength={5}
                    maxLength={300}
                    autoComplete="street-address"
                    required
                    placeholder="House number, street, area, landmark"
                    rows={3}
                  />
                </label>

                <label>
                  City *
                  <input
                    type="text"
                    value={customer.city}
                    onChange={(e) =>
                      setCustomer({ ...customer, city: e.target.value })
                    }
                    minLength={2}
                    maxLength={100}
                    autoComplete="address-level2"
                    required
                    placeholder="City"
                  />
                </label>

                <label>
                  State *
                  <input
                    type="text"
                    value={customer.state}
                    onChange={(e) =>
                      setCustomer({ ...customer, state: e.target.value })
                    }
                    minLength={2}
                    maxLength={100}
                    autoComplete="address-level1"
                    required
                    placeholder="State"
                  />
                </label>

                <label>
                  PIN code *
                  <input
                    type="text"
                    value={customer.pincode}
                    onChange={(e) =>
                      setCustomer({
                        ...customer,
                        pincode: e.target.value
                          .replace(/\D/g, "")
                          .slice(0, 6),
                      })
                    }
                    pattern="[0-9]{6}"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    required
                    placeholder="6-digit PIN code"
                  />
                </label>
              </div>

              <div className="checkout-payment-options">
                <p className="checkout-section-label">PAYMENT METHOD</p>

                <label
                  className={`checkout-payment ${
                    paymentMethod === "COD" ? "selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="COD"
                    checked={paymentMethod === "COD"}
                    onChange={() => setPaymentMethod("COD")}
                    disabled={checkoutLoading}
                  />
                  <ShieldCheck size={22} />
                  <div>
                    <strong>Cash on Delivery</strong>
                    <p>Pay when your order arrives.</p>
                  </div>
                  <strong>{formatPrice(cartTotal)}</strong>
                </label>

                <label
                  className={`checkout-payment ${
                    paymentMethod === "Razorpay" ? "selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Razorpay"
                    checked={paymentMethod === "Razorpay"}
                    onChange={() => setPaymentMethod("Razorpay")}
                    disabled={checkoutLoading}
                  />
                  <ShieldCheck size={22} />
                  <div>
                    <strong>Online Payment</strong>
                    <p>UPI, cards and other available methods via Razorpay.</p>
                  </div>
                  <strong>{formatPrice(cartTotal)}</strong>
                </label>
              </div>

              {checkoutError && (
                <p className="checkout-error" role="alert">
                  {checkoutError}
                </p>
              )}

              <div className="checkout-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={checkoutLoading}
                  onClick={() => {
                    setCheckoutOpen(false);
                    setCheckoutError("");
                  }}
                >
                  Back to bag
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={checkoutLoading || cart.length === 0}
                >
                  {checkoutLoading
                    ? "Processing..."
                    : paymentMethod === "COD"
                      ? "Place COD order"
                      : "Pay securely"}
                  {!checkoutLoading && <ArrowRight size={17} />}
                </button>
              </div>

              <p className="checkout-note">
                Your order total is calculated using current product prices.
              </p>
            </form>
          )}
        </section>

        <section className="newsletter">
          <span className="eyebrow">A NOTE FROM US</span>

          <h2>
            Good things are <em>worth sharing.</em>
          </h2>

          <p>
            Our collection is growing. Stay close for new arrivals and special
            offers.
          </p>

          <a href="#shop" className="text-link">
            Explore the collection <ArrowRight size={16} />
          </a>
        </section>
      </main>

      <footer className="footer">
        <a
          className="brand footer-brand"
          href="#home"
          aria-label="Your Divine Store home"
        >
          <img
            src="/images/your-divine-store-logo.png"
            alt="Your Divine Store"
            className="brand-logo footer-logo"
          />
        </a>

        <p>Meaningful pieces. Everyday stories.</p>

        <div className="footer-links">
          <a href="#shop">Shop</a>
          <a href="#why-us">Our Promise</a>
          <a href="mailto:support@yourdivinestore.in">Contact</a>
        </div>

        <small className="copyright">
          © {new Date().getFullYear()} Your Divine Store. All rights reserved.
        </small>
      </footer>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}