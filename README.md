# EquityBridge - Equity Crowdfunding Platform

A comprehensive equity crowdfunding platform built with Node.js, Supabase, Stripe, and Regulation CF compliance features.

## Features

### Backend
- **Node.js/Express** RESTful API
- **Supabase** for database and authentication
- **Stripe** integration for payment processing and escrow
- **Regulation CF compliance** layer with KYC, accreditation verification, and investment limits
- **Row Level Security (RLS)** for data protection
- **Audit logging** for compliance tracking

### Frontend
- **Landing page** with business listings
- **Investor dashboard** for portfolio management
- **KYC verification** workflow
- **Real-time funding progress** tracking

### Compliance Features
- KYC (Know Your Customer) verification
- Accredited investor verification
- Annual investment limits (Reg CF compliant)
- Risk disclosure acknowledgments
- Escrow fund management
- Audit trail for all transactions

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth + JWT
- **Payments**: Stripe
- **Frontend**: HTML, CSS, Vanilla JavaScript

## Project Structure

```
equitybridge/
├── config/
│   ├── supabase.js          # Supabase client configuration
│   └── stripe.js            # Stripe client configuration
├── middleware/
│   ├── auth.js              # Authentication middleware
│   └── validation.js        # Request validation schemas
├── routes/
│   ├── auth.js              # Authentication endpoints
│   ├── businesses.js        # Business listing endpoints
│   ├── investments.js       # Investment management
│   ├── users.js             # User dashboard endpoints
│   ├── stripe.js            # Stripe payment integration
│   └── compliance.js        # KYC and compliance endpoints
├── supabase/
│   ├── schema.sql           # Database schema
│   └── rpc_functions.sql    # Database functions and triggers
├── server.js                # Main Express server
├── package.json             # Dependencies
├── .env.example             # Environment variables template
├── equitybridge.html        # Landing page
└── dashboard.html           # Investor dashboard
```

## Setup Instructions

### 1. Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account
- Stripe account

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Update the following variables:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Stripe Configuration
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key

# JWT Configuration
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Database Setup

1. Create a new project in Supabase
2. Run the schema SQL in the Supabase SQL Editor:
   - Open `supabase/schema.sql`
   - Copy and execute the entire file
3. Run the RPC functions:
   - Open `supabase/rpc_functions.sql`
   - Copy and execute the entire file

### 4. Install Dependencies

```bash
npm install
```

### 5. Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:3000`

### 6. Stripe Webhook Setup

1. In your Stripe Dashboard, go to Developers > Webhooks
2. Add a new webhook pointing to: `https://your-domain.com/api/stripe/webhook`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the webhook secret to your `.env` file

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh token

### Businesses
- `GET /api/businesses` - Get all active businesses
- `GET /api/businesses/:id` - Get single business
- `POST /api/businesses` - Create business listing (business owner)
- `PUT /api/businesses/:id` - Update business (owner)
- `PATCH /api/businesses/:id/approve` - Approve business (admin)
- `GET /api/businesses/user/my-businesses` - Get user's businesses

### Investments
- `GET /api/investments/my-investments` - Get user's investments
- `POST /api/investments` - Create investment
- `PATCH /api/investments/:id/complete` - Complete investment
- `GET /api/investments/:id` - Get investment details

### Users
- `GET /api/users/dashboard` - Get dashboard data
- `PUT /api/users/profile` - Update profile
- `GET /api/users` - Get all users (admin)

### Stripe
- `POST /api/stripe/create-payment-intent` - Create payment intent
- `POST /api/stripe/webhook` - Stripe webhook handler
- `POST /api/stripe/create-connected-account` - Create Stripe account
- `POST /api/stripe/transfer-funds` - Transfer funds (admin)

### Compliance
- `POST /api/compliance/kyc` - Submit KYC
- `GET /api/compliance/kyc/status` - Get KYC status
- `PATCH /api/compliance/kyc/:userId/approve` - Approve KYC (admin)
- `POST /api/compliance/risk-disclosure` - Acknowledge risk disclosure
- `POST /api/compliance/validate-investment` - Validate investment limits

## Regulation CF Compliance

This platform implements key Regulation CF requirements:

### Investment Limits
- Non-accredited investors: Limited based on income/net worth
- Accredited investors: Higher limits available
- Annual tracking and enforcement

### KYC Verification
- Identity verification required before investing
- SSN verification
- Address verification
- Accreditation status verification

### Escrow Management
- Funds held in escrow until funding goal is met
- Automatic refund if campaign fails
- 30-day escrow period after funding

### Risk Disclosures
- Mandatory risk acknowledgment before investing
- Version-controlled disclosure documents
- Audit trail of acknowledgments

### Audit Trail
- All transactions logged
- User actions tracked
- Compliance records maintained

## Security Features

- **JWT Authentication** with expiration
- **Row Level Security (RLS)** in Supabase
- **Rate limiting** on API endpoints
- **Helmet.js** for HTTP security headers
- **Input validation** with Joi schemas
- **CORS** configuration
- **Environment variable** protection

## Development

### Adding New Features

1. Add database migrations to `supabase/schema.sql`
2. Create API routes in `routes/`
3. Add validation schemas in `middleware/validation.js`
4. Update frontend as needed

### Testing

```bash
npm test
```

## Deployment

### Backend (Node.js)

Deploy to your preferred platform:
- Vercel
- Railway
- Render
- AWS EC2
- DigitalOcean

Ensure to:
1. Set environment variables
2. Configure production database
3. Set up SSL certificates
4. Configure Stripe webhooks

### Frontend

The HTML files can be served from:
- The same Node.js server (add static file serving)
- Netlify
- Vercel
- Any static hosting service

Update `API_BASE` in the frontend JavaScript to point to your production API.

## Support

For issues or questions:
- Check the API documentation
- Review the database schema
- Ensure all environment variables are set
- Verify Supabase and Stripe configurations

## License

MIT License - See LICENSE file for details

## Disclaimer

This is a demonstration platform. Real equity crowdfunding requires:
- SEC registration (Form C)
- FINRA membership
- Legal counsel
- Compliance with all applicable regulations

Use at your own risk.
