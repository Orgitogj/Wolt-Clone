# Wolt Clone

> A production-style food delivery mobile application built with Expo, React Native, and Supabase.

## Project Overview

This repository contains a mobile app inspired by the Wolt experience. It demonstrates:

- A polished food delivery app experience for browsing restaurants, menus, and placing orders

- Native mobile UI using `expo` and `react-native`
- File-based routing with `expo-router`
- Supabase authentication, storage, and database integration
- A restaurant browsing experience with categories, menus, and dish details
- Order creation, history, and favorite restaurant support
- Persistent session storage via Async Storage

The app is structured to separate UI, data access, and business logic. It uses a Supabase backend for authentication and a relational schema that supports real-world food delivery requirements.

## Key Technologies

- `expo` / `expo-router`
- `react-native`
- `supabase-js`
- `@tanstack/react-query`
- `zustand`
- `expo-linear-gradient`
- `expo-location` and `react-native-maps`
- `typescript`

## Database Schema

The Supabase schema is defined in `supabase/schema.sql`. The main entities are:

- `profiles` — user profile data and metadata
- `addresses` — delivery addresses tied to authenticated users
- `categories` — restaurant categories and visual presentation metadata
- `restaurants` — restaurant details, ratings, menus, and location data
- `restaurant_categories` — category assignments for restaurants
- `menu_categories` — menu section groups for each restaurant
- `dishes` — dish catalog, availability, dietary tags, and pricing
- `dish_addons` — optional add-ons and price adjustments for dishes
- `favorites` — saved restaurants per user
- `orders` — placed orders with delivery, payment, and pricing fields
- `order_items` — order line items, dish snapshot, and addons

Additional database behavior:

- A trigger creates `profiles` for newly registered auth users
- Row-level security is enabled for user-scoped tables
- Public select policies allow restaurant and menu browsing without authentication
- User-specific policies enforce access to profile, address, favorite, order, and order item records
- A public storage bucket is configured for app image hosting

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Orgitogj/Wolt-Clone.git
cd Wolt-Clone
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment variables

Copy the environment example and configure Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Configure Supabase

Apply the schema in `supabase/schema.sql` to your Supabase project. This establishes the tables, indexes, triggers, policies, and storage bucket used by the app.

### 5. Seed sample data (optional)

If seed data is available, run:

```bash
npm run seed
```

### 6. Run the app

```bash
npm start
```

Then open the app in one of the supported targets:

- Android emulator
- iOS simulator
- Expo Go

## App Architecture

- `app/` — main Expo Router pages and navigation structure
- `components/` — reusable UI components and buttons
- `hooks/` — custom hooks for profile, restaurants, menu, favorites, and orders
- `lib/supabase.ts` — Supabase client configuration
- `services/` — backend service layer for data queries and mutations
- `supabase/schema.sql` — database schema, RLS policies, and storage configuration
- `scripts/seed.mjs` — optional data seeding script

## GitHub

Repository: https://github.com/Orgitogj/Wolt-Clone

## How to Review

A reviewer can verify:

- Authentication flow via Supabase
- Restaurant listing and category filtering
- Menu browsing and dish selection
- Order placement and history retrieval
- Profile editing and address management
- Backend policy enforcement and secure user data access

