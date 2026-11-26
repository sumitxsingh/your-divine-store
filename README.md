Your Divine Store 🛍️

Your Divine Store is a full-stack e-commerce platform focused on religious pendants, spiritual accessories, and fashion jewellery. The platform aims to provide customers with a smooth, secure, and user-friendly online shopping experience.

«🚧 Project Status: Work in Progress

Your Divine Store is currently under active development. New features, improvements, integrations, and optimizations are being implemented. The project is not yet complete.»

✨ Features

- User-friendly and responsive interface
- Product browsing and category-based shopping
- Product details and image galleries
- User authentication and account management
- Shopping cart and order management
- Online payments using Razorpay
- Cash on Delivery (COD)
- Payment verification and webhook integration
- Refund processing and order reconciliation
- Inventory and stock management
- Admin panel for managing products and orders
- Shipping integration (in development)

🛠️ Tech Stack

Technology| Purpose
React.js| Frontend
Vite| Frontend build tool
Node.js| Backend runtime
Express.js| Backend framework
MongoDB| Database
Razorpay| Payment gateway
Cloudflare Workers| Frontend deployment
Render| Backend deployment
Git & GitHub| Version control

📁 Project Structure

your-divine-store/
│
├── frontend/
│   ├── public/
│   ├── src/
│   └── package.json
│
├── backend/
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   ├── services/
│   ├── middleware/
│   ├── server.js
│   └── package.json
│
├── README.md
└── .gitignore

Note: The structure may evolve as development progresses.

⚙️ Installation & Setup

1. Clone the Repository

git clone https://github.com/sumitxsingh/your-divine-store.git
cd your-divine-store

2. Backend Setup

cd backend
npm install

Create a ".env" file inside the backend directory and configure the required environment variables.

3. Frontend Setup

cd frontend
npm install
npm run dev

4. Start the Backend

From the backend directory:

npm run dev

Note: Actual scripts may vary depending on the current package configuration.

🔐 Environment Variables

Configure the required environment variables in your local ".env" file.

Example:

PORT=5000
MONGODB_URI=your_mongodb_connection_string

JWT_SECRET=your_jwt_secret

RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret

FRONTEND_URL=your_frontend_url

Never commit your ".env" file or expose API keys and secrets publicly.

💳 Payment Integration

The platform uses Razorpay for online payment processing.

Payment-related functionality includes:

- Payment order creation
- Payment verification
- Payment failure handling
- Webhook event processing
- Refund processing
- Refund status tracking
- Order reconciliation

Cash on Delivery is also planned as a supported payment option.

📦 Order & Inventory Management

- Order creation and tracking
- Payment status management
- Order status updates
- Stock reservation and restoration
- Refund management
- Inventory synchronization

🔗 API Endpoints

The backend provides REST API routes for:

Endpoint| Purpose
"/api/auth"| Authentication
"/api/products"| Product management
"/api/orders"| Order management
"/api/payments"| Payment processing
"/api/images"| Image management

Additional endpoints may be introduced during development.

🚀 Deployment

The current deployment setup includes:

- Frontend: Cloudflare Workers
- Backend: Render
- Database: MongoDB Atlas

🗺️ Development Roadmap

- [x] Initial frontend and backend setup
- [x] MongoDB integration
- [x] Razorpay integration
- [x] Basic order management
- [x] Payment webhook integration
- [x] Refund processing implementation
- [ ] Complete admin dashboard
- [ ] Improve product management
- [ ] Complete shipping integration
- [ ] Comprehensive testing
- [ ] Performance and security improvements
- [ ] Production launch

Roadmap status reflects ongoing development and may change.

👨‍💻 Developer

Sumit Singh

- GitHub: "@sumitxsingh" (https://github.com/sumitxsingh)
- LinkedIn: "sumitxsingh" (https://linkedin.com/in/sumitxsingh01)

---

⭐ If you find this project interesting, consider giving it a star!

Your Divine Store — Bringing Faith and Style Together.
