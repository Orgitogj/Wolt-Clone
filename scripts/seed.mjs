
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'images', 'dummy');
const BUCKET = 'app-images';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars before running this script.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

const uploadCache = new Map();

async function uploadImage(relPath) {
  if (uploadCache.has(relPath)) return uploadCache.get(relPath);
  const fullPath = path.join(ASSETS_DIR, relPath);
  const data = fs.readFileSync(fullPath);
  const storagePath = relPath.replace(/\\/g, '/');
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, data, {
    contentType: mimeFor(fullPath),
    upsert: true,
  });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  uploadCache.set(relPath, pub.publicUrl);
  console.log(`Uploaded ${storagePath}`);
  return pub.publicUrl;
}

async function insertReturning(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  return data;
}


const CATEGORIES = [
  { name: 'Street Food', image: 'categories/street_food.png', backgroundColor: '#E8DCD9', sortOrder: 0 },
  { name: 'Burger', image: 'categories/burger.png', backgroundColor: '#F5EFCF', sortOrder: 1 },
  { name: 'American', image: 'categories/american.png', backgroundColor: '#F5EFCF', sortOrder: 2 },
  { name: 'Chicken', image: 'categories/chicken.png', backgroundColor: '#F4D7C7', sortOrder: 3 },
  { name: 'Pizza', image: 'categories/pizza.png', backgroundColor: '#E5E5E5', sortOrder: 4 },
  { name: 'BBQ', image: 'categories/bbq.png', backgroundColor: '#E5E5E5', sortOrder: 5 },
];

const FOOD_IMAGES = Array.from({ length: 10 }, (_, i) => `menu/${i + 1}.png`);
const GENERIC_RESTAURANT_IMAGE = 'menu/restaurant1.jpeg';

const STANDARD_ADDONS = [
  { name: 'Yogurt sauce', priceDelta: 0 },
  { name: 'Extra spicy', priceDelta: 0 },
  { name: 'Extra sauce', priceDelta: 0.5 },
];

const RESTAURANTS = [
  {
    key: 'rest_001',
    name: 'Pizza Perfetto',
    description: 'Authentic Italian pizza & pasta',
    cuisines: ['Italian', 'Pizza'],
    tags: ['Fast delivery', 'Free delivery over €15'],
    categories: ['Pizza'],
    rating: 4.6,
    reviewCount: 1247,
    deliveryTimeMin: 25,
    deliveryTimeMax: 35,
    deliveryFee: 1.9,
    minOrder: 10.0,
    address: 'Prinzipalmarkt 12, 48143 Münster',
    latitude: 51.9625,
    longitude: 7.6257,
    image: 'pizza_perfetto.png',
    openingHours: {
      monday: '11:00-22:00', tuesday: '11:00-22:00', wednesday: '11:00-22:00', thursday: '11:00-22:00',
      friday: '11:00-23:00', saturday: '12:00-23:00', sunday: '12:00-22:00',
    },
    menu: [
      {
        name: 'Speciale', subtitle: 'Speciale',
        dishes: [
          { name: 'Build your own Pizza', description: 'Be individual and build your unique pizza according to your wishes', price: 11.75, isPopular: true, addons: true, image: FOOD_IMAGES[0] },
          { name: 'Build your own Salad', description: 'Build your own salad now. Be individual and create your unique combination', price: 10.95, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
        ],
      },
      {
        name: 'Menu della Casa', subtitle: 'Menu della Casa',
        dishes: [
          { name: 'Insalata di Zucca', description: 'Wild herb salad with roasted pumpkin, pomegranate seeds, toasted walnuts', price: 12.95, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
          { name: 'Risotto alla Zucca e Rucola', description: 'White wine risotto with pumpkin sauce, roasted pumpkin, arugula, toasted walnuts', price: 13.95, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[3] },
          { name: 'Pizza Zucca e Spinaci', description: 'With pumpkin sauce, cheese, roasted pumpkin, spinach, red onions, Italian herbs', price: 14.95, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[4] },
        ],
      },
      {
        name: 'Antipasti', subtitle: 'Antipasti',
        dishes: [
          { name: 'Bruschetta', description: 'Fresh tomatoes, garlic, basil', price: 8.75, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[5] },
          { name: 'Pizza Pane', description: 'Pizza bread with tomatoes and garlic', price: 6.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[6] },
          { name: 'Focaccia Rosmarino', description: 'Italian flatbread with rosemary and olive oil', price: 7.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[7] },
        ],
      },
      {
        name: 'Insalate', subtitle: 'Insalate',
        dishes: [
          { name: 'Insalata Caprese', description: 'Tomatoes, mozzarella, basil, olive oil', price: 9.95, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[8] },
          { name: 'Insalata Mista', description: 'Mixed salad with tomatoes, cucumbers, carrots', price: 8.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[9] },
          { name: 'Caesar Salad', description: 'Romaine lettuce, chicken breast, parmesan, Caesar dressing', price: 11.95, addons: false, image: FOOD_IMAGES[0] },
        ],
      },
      {
        name: 'Pizza Classiche', subtitle: 'Pizza Classiche',
        dishes: [
          { name: 'Pizza Margherita', description: 'Tomato sauce, mozzarella, basil', price: 9.9, isPopular: true, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
          { name: 'Pizza Diavola', description: 'Tomato sauce, mozzarella, spicy salami', price: 12.9, addons: true, image: FOOD_IMAGES[2] },
          { name: 'Pizza Quattro Formaggi', description: 'Four cheese varieties: mozzarella, gorgonzola, parmesan, taleggio', price: 13.5, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[3] },
          { name: 'Pizza Prosciutto e Funghi', description: 'Tomato sauce, mozzarella, ham, mushrooms', price: 12.9, addons: true, image: FOOD_IMAGES[4] },
        ],
      },
      {
        name: 'Pasta', subtitle: 'Pasta',
        dishes: [
          { name: 'Spaghetti Carbonara', description: 'Egg, bacon, parmesan, black pepper', price: 11.5, isPopular: true, addons: true, image: FOOD_IMAGES[5] },
          { name: 'Penne Arrabbiata', description: 'Spicy tomato sauce, garlic, chili', price: 9.9, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[6] },
          { name: 'Tagliatelle al Ragù', description: 'Traditional Bolognese sauce', price: 12.9, addons: false, image: FOOD_IMAGES[7] },
          { name: 'Lasagne alla Bolognese', description: 'Layered pasta with meat sauce and béchamel', price: 13.5, addons: false, image: FOOD_IMAGES[8] },
        ],
      },
      {
        name: 'Dolci', subtitle: 'Dolci',
        dishes: [
          { name: 'Tiramisù', description: 'Classic Italian dessert with mascarpone and espresso', price: 5.9, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[9] },
          { name: 'Panna Cotta', description: 'Vanilla cream with berry sauce', price: 4.9, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[0] },
        ],
      },
    ],
  },
  {
    key: 'rest_002',
    name: 'Burgerhaven',
    description: 'Juicy burgers & crispy fries',
    cuisines: ['American', 'Burgers'],
    tags: ['Popular', "Chef's Choice"],
    categories: ['Burger', 'American'],
    rating: 4.8,
    reviewCount: 2156,
    deliveryTimeMin: 20,
    deliveryTimeMax: 30,
    deliveryFee: 2.5,
    minOrder: 12.0,
    address: 'Salzstraße 28, 48143 Münster',
    latitude: 51.9618,
    longitude: 7.6289,
    image: 'burgerhaven.png',
    openingHours: {
      monday: '11:30-22:30', tuesday: '11:30-22:30', wednesday: '11:30-22:30', thursday: '11:30-22:30',
      friday: '11:30-00:00', saturday: '12:00-00:00', sunday: '12:00-22:00',
    },
    menu: [
      {
        name: 'Burgers', subtitle: 'Burgers',
        dishes: [
          { name: 'Classic Cheeseburger', description: 'Beef patty, cheddar, lettuce, tomato, house sauce', price: 9.9, isPopular: true, addons: true, image: FOOD_IMAGES[0] },
          { name: 'Bacon BBQ Burger', description: 'Beef patty, crispy bacon, BBQ sauce, onion rings', price: 11.5, addons: true, image: FOOD_IMAGES[1] },
          { name: 'Veggie Burger', description: 'Plant-based patty, avocado, lettuce, vegan mayo', price: 10.2, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
          { name: 'Double Smash Burger', description: 'Two smashed beef patties, double cheese, pickles', price: 12.9, isPopular: true, addons: true, image: FOOD_IMAGES[3] },
        ],
      },
      {
        name: 'Sides & Drinks', subtitle: 'Sides & Drinks',
        dishes: [
          { name: 'Crispy Fries', description: 'Golden fries with sea salt', price: 3.9, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[4] },
          { name: 'Onion Rings', description: 'Crispy battered onion rings', price: 4.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[5] },
          { name: 'Coleslaw', description: 'Fresh cabbage & carrot slaw', price: 3.2, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[6] },
          { name: 'Vanilla Milkshake', description: 'Creamy vanilla milkshake', price: 4.9, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[7] },
        ],
      },
    ],
  },
  {
    key: 'rest_003',
    name: 'Sushi Takumi',
    description: 'Fresh sushi & Japanese cuisine',
    cuisines: ['Japanese', 'Sushi', 'Asian'],
    tags: ['Premium quality', 'Sustainable'],
    categories: [],
    rating: 4.7,
    reviewCount: 892,
    deliveryTimeMin: 30,
    deliveryTimeMax: 40,
    deliveryFee: 2.9,
    minOrder: 15.0,
    address: 'Ludgeristraße 45, 48143 Münster',
    latitude: 51.9635,
    longitude: 7.6234,
    image: 'sushi_takumi.png',
    openingHours: {
      monday: '12:00-21:30', tuesday: '12:00-21:30', wednesday: '12:00-21:30', thursday: '12:00-21:30',
      friday: '12:00-22:30', saturday: '12:00-22:30', sunday: '13:00-21:00',
    },
    menu: [
      {
        name: 'Nigiri & Sashimi', subtitle: 'Nigiri & Sashimi',
        dishes: [
          { name: 'Salmon Nigiri', description: '2 pieces, fresh Norwegian salmon', price: 6.5, isPopular: true, addons: false, image: FOOD_IMAGES[8] },
          { name: 'Tuna Sashimi', description: '5 slices of fresh tuna', price: 8.9, addons: false, image: FOOD_IMAGES[9] },
          { name: 'Mixed Sashimi Platter', description: 'Salmon, tuna, and yellowtail sashimi selection', price: 14.9, addons: false, image: FOOD_IMAGES[0] },
        ],
      },
      {
        name: 'Rolls', subtitle: 'Rolls',
        dishes: [
          { name: 'California Roll', description: 'Crab, avocado, cucumber, sesame', price: 7.9, isPopular: true, addons: false, image: FOOD_IMAGES[1] },
          { name: 'Dragon Roll', description: 'Shrimp tempura, eel, avocado', price: 9.5, addons: false, image: FOOD_IMAGES[2] },
          { name: 'Veggie Roll', description: 'Cucumber, avocado, pickled radish', price: 6.9, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[3] },
        ],
      },
      {
        name: 'Sides', subtitle: 'Sides',
        dishes: [
          { name: 'Miso Soup', description: 'Traditional soybean paste soup with tofu', price: 3.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[4] },
          { name: 'Edamame', description: 'Steamed soybeans with sea salt', price: 4.2, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[5] },
        ],
      },
    ],
  },
  {
    key: 'rest_004',
    name: 'Döner Palace',
    description: 'Traditional Turkish döner & more',
    cuisines: ['Turkish', 'Kebab', 'Mediterranean'],
    tags: ['Budget friendly', 'Fast delivery'],
    categories: ['Street Food'],
    rating: 4.5,
    reviewCount: 1678,
    deliveryTimeMin: 15,
    deliveryTimeMax: 25,
    deliveryFee: 1.5,
    minOrder: 8.0,
    address: 'Hammer Straße 18, 48153 Münster',
    latitude: 51.9642,
    longitude: 7.6312,
    image: 'doner_palace.png',
    openingHours: {
      monday: '10:30-23:00', tuesday: '10:30-23:00', wednesday: '10:30-23:00', thursday: '10:30-23:00',
      friday: '10:30-01:00', saturday: '11:00-01:00', sunday: '11:00-23:00',
    },
    menu: [
      {
        name: 'Döner', subtitle: 'Döner',
        dishes: [
          { name: 'Chicken Döner', description: 'Grilled chicken, salad, garlic sauce in flatbread', price: 6.5, isPopular: true, addons: true, image: FOOD_IMAGES[6] },
          { name: 'Beef Döner', description: 'Grilled beef, salad, spicy sauce in flatbread', price: 7.0, addons: true, image: FOOD_IMAGES[7] },
          { name: 'Vegetarian Döner', description: 'Grilled halloumi, salad, herb sauce in flatbread', price: 6.0, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[8] },
        ],
      },
      {
        name: 'Plates', subtitle: 'Plates',
        dishes: [
          { name: 'Mixed Grill Plate', description: 'Chicken, beef, rice, grilled vegetables', price: 13.9, isPopular: true, addons: true, image: FOOD_IMAGES[9] },
          { name: 'Falafel Plate', description: 'Falafel, hummus, salad, rice', price: 9.5, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[0] },
        ],
      },
      {
        name: 'Sides', subtitle: 'Sides',
        dishes: [
          { name: 'Ayran', description: 'Traditional Turkish yogurt drink', price: 2.0, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
          { name: 'Baklava', description: 'Sweet pastry with pistachio and honey', price: 3.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
        ],
      },
    ],
  },
  {
    key: 'rest_005',
    name: 'Pad Thai House',
    description: 'Authentic Thai street food',
    cuisines: ['Thai', 'Asian', 'Vegetarian'],
    tags: ['Vegan options', 'Spicy'],
    categories: [],
    rating: 4.6,
    reviewCount: 743,
    deliveryTimeMin: 25,
    deliveryTimeMax: 35,
    deliveryFee: 2.2,
    minOrder: 11.0,
    address: 'Warendorfer Straße 67, 48145 Münster',
    latitude: 51.9598,
    longitude: 7.6401,
    image: 'pad_thai_house.png',
    openingHours: {
      monday: '11:30-22:00', tuesday: '11:30-22:00', wednesday: '11:30-22:00', thursday: '11:30-22:00',
      friday: '11:30-22:30', saturday: '12:00-22:30', sunday: '12:00-21:30',
    },
    menu: [
      {
        name: 'Noodles', subtitle: 'Noodles',
        dishes: [
          { name: 'Pad Thai Chicken', description: 'Rice noodles, chicken, egg, peanuts, tamarind sauce', price: 10.9, isPopular: true, addons: true, image: FOOD_IMAGES[3] },
          { name: 'Pad Thai Tofu', description: 'Rice noodles, tofu, egg, peanuts, tamarind sauce', price: 10.5, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[4] },
          { name: 'Pad See Ew', description: 'Wide rice noodles, Chinese broccoli, soy sauce', price: 10.9, addons: true, image: FOOD_IMAGES[5] },
        ],
      },
      {
        name: 'Curries', subtitle: 'Curries',
        dishes: [
          { name: 'Green Curry', description: 'Coconut green curry with chicken and vegetables', price: 11.5, isPopular: true, addons: true, image: FOOD_IMAGES[6] },
          { name: 'Red Curry Vegetable', description: 'Coconut red curry with mixed vegetables', price: 10.9, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[7] },
        ],
      },
      {
        name: 'Starters', subtitle: 'Starters',
        dishes: [
          { name: 'Spring Rolls', description: 'Crispy vegetable spring rolls with sweet chili sauce', price: 5.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[8] },
          { name: 'Tom Yum Soup', description: 'Spicy and sour Thai soup with shrimp', price: 5.9, addons: true, image: FOOD_IMAGES[9] },
        ],
      },
    ],
  },
  {
    key: 'rest_006',
    name: 'Salad Bar Fresh',
    description: 'Healthy salads & bowls',
    cuisines: ['Healthy', 'Salads', 'Vegetarian'],
    tags: ['Healthy', 'Vegan options', 'Gluten-free'],
    categories: [],
    rating: 4.4,
    reviewCount: 521,
    deliveryTimeMin: 20,
    deliveryTimeMax: 30,
    deliveryFee: 2.0,
    minOrder: 9.0,
    address: 'Rothenburg 34, 48143 Münster',
    latitude: 51.9611,
    longitude: 7.6298,
    image: null,
    openingHours: {
      monday: '10:00-20:00', tuesday: '10:00-20:00', wednesday: '10:00-20:00', thursday: '10:00-20:00',
      friday: '10:00-20:00', saturday: '11:00-19:00', sunday: 'Closed',
    },
    menu: [
      {
        name: 'Salads', subtitle: 'Salads',
        dishes: [
          { name: 'Caesar Salad', description: 'Romaine, chicken, parmesan, Caesar dressing', price: 8.9, addons: false, image: FOOD_IMAGES[0] },
          { name: 'Greek Salad', description: 'Feta, olives, cucumber, tomato, red onion', price: 8.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
          { name: 'Quinoa Power Bowl', description: 'Quinoa, roasted vegetables, chickpeas, tahini dressing', price: 9.9, isPopular: true, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[2] },
        ],
      },
      {
        name: 'Bowls', subtitle: 'Bowls',
        dishes: [
          { name: 'Buddha Bowl', description: 'Sweet potato, kale, avocado, brown rice', price: 10.5, isPopular: true, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[3] },
          { name: 'Chicken Avocado Bowl', description: 'Grilled chicken, avocado, mixed greens, lime dressing', price: 11.2, addons: false, image: FOOD_IMAGES[4] },
        ],
      },
      {
        name: 'Extras', subtitle: 'Extras',
        dishes: [
          { name: 'Fresh Juice', description: 'Cold-pressed seasonal fruit juice', price: 3.9, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[5] },
          { name: 'Protein Boost', description: 'Extra grilled chicken or tofu add-on', price: 1.5, addons: false, image: FOOD_IMAGES[6] },
        ],
      },
    ],
  },
  {
    key: 'rest_007',
    name: 'Curry Corner',
    description: 'Flavorful Indian curries & tandoori',
    cuisines: ['Indian', 'Curry', 'Asian'],
    tags: ['Spicy', 'Vegetarian options'],
    categories: ['Chicken'],
    rating: 4.7,
    reviewCount: 1034,
    deliveryTimeMin: 30,
    deliveryTimeMax: 40,
    deliveryFee: 2.4,
    minOrder: 13.0,
    address: 'Wolbecker Straße 112, 48155 Münster',
    latitude: 51.9589,
    longitude: 7.6445,
    image: null,
    openingHours: {
      monday: '11:00-22:00', tuesday: '11:00-22:00', wednesday: '11:00-22:00', thursday: '11:00-22:00',
      friday: '11:00-23:00', saturday: '12:00-23:00', sunday: '12:00-22:00',
    },
    menu: [
      {
        name: 'Curries', subtitle: 'Curries',
        dishes: [
          { name: 'Butter Chicken', description: 'Chicken in creamy tomato butter sauce', price: 12.5, isPopular: true, addons: true, image: FOOD_IMAGES[7] },
          { name: 'Chana Masala', description: 'Chickpeas in spiced tomato gravy', price: 10.5, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[8] },
          { name: 'Lamb Rogan Josh', description: 'Slow-cooked lamb in aromatic curry sauce', price: 13.9, addons: true, image: FOOD_IMAGES[9] },
        ],
      },
      {
        name: 'Tandoori', subtitle: 'Tandoori',
        dishes: [
          { name: 'Tandoori Chicken', description: 'Char-grilled marinated chicken', price: 11.9, isPopular: true, addons: true, image: FOOD_IMAGES[0] },
          { name: 'Paneer Tikka', description: 'Char-grilled marinated cottage cheese', price: 10.9, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
        ],
      },
      {
        name: 'Breads & Rice', subtitle: 'Breads & Rice',
        dishes: [
          { name: 'Garlic Naan', description: 'Oven-baked flatbread with garlic butter', price: 3.2, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
          { name: 'Basmati Rice', description: 'Steamed fragrant basmati rice', price: 2.8, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[3] },
        ],
      },
    ],
  },
  {
    key: 'rest_008',
    name: 'Poke Bowl Paradise',
    description: 'Fresh Hawaiian poke bowls',
    cuisines: ['Hawaiian', 'Healthy', 'Seafood'],
    tags: ['Fresh ingredients', 'Healthy'],
    categories: [],
    rating: 4.5,
    reviewCount: 687,
    deliveryTimeMin: 25,
    deliveryTimeMax: 35,
    deliveryFee: 2.7,
    minOrder: 12.0,
    address: 'Aegidiistraße 56, 48143 Münster',
    latitude: 51.9603,
    longitude: 7.6311,
    image: null,
    openingHours: {
      monday: '11:00-21:00', tuesday: '11:00-21:00', wednesday: '11:00-21:00', thursday: '11:00-21:00',
      friday: '11:00-21:30', saturday: '11:30-21:30', sunday: '12:00-20:00',
    },
    menu: [
      {
        name: 'Poke Bowls', subtitle: 'Poke Bowls',
        dishes: [
          { name: 'Classic Tuna Poke', description: 'Ahi tuna, rice, edamame, avocado, sesame dressing', price: 12.9, isPopular: true, addons: false, image: FOOD_IMAGES[4] },
          { name: 'Salmon Poke', description: 'Salmon, rice, cucumber, mango, spicy mayo', price: 12.5, addons: false, image: FOOD_IMAGES[5] },
          { name: 'Vegan Tofu Poke', description: 'Marinated tofu, rice, edamame, avocado, ginger dressing', price: 10.9, isPopular: true, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[6] },
        ],
      },
      {
        name: 'Add-ons', subtitle: 'Add-ons',
        dishes: [
          { name: 'Extra Avocado', description: 'Fresh sliced avocado', price: 1.8, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[7] },
          { name: 'Seaweed Salad', description: 'Marinated seaweed salad', price: 3.2, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[8] },
        ],
      },
    ],
  },
  {
    key: 'rest_009',
    name: 'La Baguette',
    description: 'French bakery & café',
    cuisines: ['French', 'Bakery', 'Café'],
    tags: ['Breakfast', 'Coffee', 'Pastries'],
    categories: [],
    rating: 4.8,
    reviewCount: 1523,
    deliveryTimeMin: 20,
    deliveryTimeMax: 30,
    deliveryFee: 1.8,
    minOrder: 7.0,
    address: 'Königsstraße 42, 48143 Münster',
    latitude: 51.9628,
    longitude: 7.6278,
    image: null,
    openingHours: {
      monday: '07:00-19:00', tuesday: '07:00-19:00', wednesday: '07:00-19:00', thursday: '07:00-19:00',
      friday: '07:00-20:00', saturday: '08:00-20:00', sunday: '08:00-18:00',
    },
    menu: [
      {
        name: 'Pastries', subtitle: 'Pastries',
        dishes: [
          { name: 'Croissant', description: 'Classic buttery French croissant', price: 2.8, isPopular: true, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[9] },
          { name: 'Pain au Chocolat', description: 'Buttery pastry with dark chocolate', price: 3.2, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[0] },
          { name: 'Almond Croissant', description: 'Croissant filled with almond cream', price: 3.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[1] },
        ],
      },
      {
        name: 'Café', subtitle: 'Café',
        dishes: [
          { name: 'Cappuccino', description: 'Espresso with steamed milk foam', price: 3.5, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
          { name: 'Café au Lait', description: 'Espresso with warm milk', price: 3.2, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[3] },
        ],
      },
      {
        name: 'Sandwiches', subtitle: 'Sandwiches',
        dishes: [
          { name: 'Jambon-Beurre', description: 'Classic French ham and butter baguette', price: 5.9, isPopular: true, addons: false, image: FOOD_IMAGES[4] },
          { name: 'Veggie Baguette', description: 'Grilled vegetables and hummus baguette', price: 5.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[5] },
        ],
      },
    ],
  },
  {
    key: 'rest_010',
    name: 'Taco Loco',
    description: 'Mexican street food & tacos',
    cuisines: ['Mexican', 'Tacos', 'Latin American'],
    tags: ['Spicy', 'Vegetarian options'],
    categories: ['Street Food'],
    rating: 4.6,
    reviewCount: 945,
    deliveryTimeMin: 25,
    deliveryTimeMax: 35,
    deliveryFee: 2.3,
    minOrder: 11.0,
    address: 'Steinfurter Straße 89, 48149 Münster',
    latitude: 51.9711,
    longitude: 7.6189,
    image: null,
    openingHours: {
      monday: '11:30-22:00', tuesday: '11:30-22:00', wednesday: '11:30-22:00', thursday: '11:30-22:00',
      friday: '11:30-23:00', saturday: '12:00-23:00', sunday: '12:00-22:00',
    },
    menu: [
      {
        name: 'Tacos', subtitle: 'Tacos',
        dishes: [
          { name: 'Carnitas Tacos', description: 'Slow-cooked pork, onion, cilantro, salsa verde (3 pcs)', price: 9.9, isPopular: true, addons: true, image: FOOD_IMAGES[6] },
          { name: 'Al Pastor Tacos', description: 'Marinated pork, pineapple, onion, cilantro (3 pcs)', price: 10.5, addons: true, image: FOOD_IMAGES[7] },
          { name: 'Veggie Tacos', description: 'Grilled peppers, black beans, avocado, salsa (3 pcs)', price: 8.9, isPopular: true, addons: true, dietaryTags: ['vegan'], image: FOOD_IMAGES[8] },
        ],
      },
      {
        name: 'Bowls & More', subtitle: 'Bowls & More',
        dishes: [
          { name: 'Burrito Bowl', description: 'Rice, beans, grilled chicken, pico de gallo', price: 11.2, addons: true, image: FOOD_IMAGES[9] },
          { name: 'Quesadilla', description: 'Grilled tortilla, melted cheese, peppers', price: 8.5, addons: true, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[0] },
        ],
      },
      {
        name: 'Sides', subtitle: 'Sides',
        dishes: [
          { name: 'Guacamole & Chips', description: 'Fresh guacamole with tortilla chips', price: 4.5, addons: false, dietaryTags: ['vegan'], image: FOOD_IMAGES[1] },
          { name: 'Elote', description: 'Grilled corn with lime, cheese, chili powder', price: 3.9, addons: false, dietaryTags: ['vegetarian'], image: FOOD_IMAGES[2] },
        ],
      },
    ],
  },
];



async function main() {
  console.log('Uploading category images...');
  for (const cat of CATEGORIES) {
    cat.imageUrl = await uploadImage(cat.image);
  }

  console.log('Inserting categories...');
  const insertedCategories = await insertReturning(
    'categories',
    CATEGORIES.map((c) => ({
      name: c.name,
      image_url: c.imageUrl,
      background_color: c.backgroundColor,
      sort_order: c.sortOrder,
    }))
  );
  const categoryIdByName = new Map(insertedCategories.map((c) => [c.name, c.id]));

  console.log('Uploading restaurant photos & inserting restaurants...');
  const restaurantIdByKey = new Map();
  const restaurantCategoryRows = [];

  for (const r of RESTAURANTS) {
    const imageUrl = await uploadImage(r.image ?? GENERIC_RESTAURANT_IMAGE);
    const [inserted] = await insertReturning('restaurants', [
      {
        name: r.name,
        description: r.description,
        image_url: imageUrl,
        rating: r.rating,
        review_count: r.reviewCount,
        delivery_time_min: r.deliveryTimeMin,
        delivery_time_max: r.deliveryTimeMax,
        delivery_fee: r.deliveryFee,
        min_order: r.minOrder,
        address: r.address,
        latitude: r.latitude,
        longitude: r.longitude,
        is_open: true,
        cuisines: r.cuisines,
        tags: r.tags,
        opening_hours: r.openingHours,
      },
    ]);
    restaurantIdByKey.set(r.key, inserted.id);
    console.log(`  Inserted ${r.name}`);

    for (const categoryName of r.categories) {
      const categoryId = categoryIdByName.get(categoryName);
      if (categoryId) restaurantCategoryRows.push({ restaurant_id: inserted.id, category_id: categoryId });
    }
  }

  if (restaurantCategoryRows.length) {
    console.log('Linking restaurants to categories...');
    await insertReturning('restaurant_categories', restaurantCategoryRows);
  }

  console.log('Inserting menus, dishes and add-ons...');
  for (const r of RESTAURANTS) {
    const restaurantId = restaurantIdByKey.get(r.key);
    let menuSortOrder = 0;
    for (const menuCategory of r.menu) {
      const [insertedMenuCategory] = await insertReturning('menu_categories', [
        {
          restaurant_id: restaurantId,
          name: menuCategory.name,
          subtitle: menuCategory.subtitle ?? null,
          sort_order: menuSortOrder++,
        },
      ]);

      const dishRows = [];
      let dishSortOrder = 0;
      for (const dish of menuCategory.dishes) {
        const imageUrl = await uploadImage(dish.image);
        dishRows.push({
          restaurant_id: restaurantId,
          menu_category_id: insertedMenuCategory.id,
          name: dish.name,
          description: dish.description,
          price: dish.price,
          image_url: imageUrl,
          is_popular: !!dish.isPopular,
          is_available: true,
          dietary_tags: dish.dietaryTags ?? [],
          sort_order: dishSortOrder++,
        });
      }
      const insertedDishes = await insertReturning('dishes', dishRows);

      const addonRows = [];
      insertedDishes.forEach((insertedDish, i) => {
        if (menuCategory.dishes[i].addons) {
          STANDARD_ADDONS.forEach((addon, addonIndex) => {
            addonRows.push({
              dish_id: insertedDish.id,
              name: addon.name,
              price_delta: addon.priceDelta,
              sort_order: addonIndex,
            });
          });
        }
      });
      if (addonRows.length) await insertReturning('dish_addons', addonRows);
    }
    console.log(`  Seeded menu for ${r.name}`);
  }

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
