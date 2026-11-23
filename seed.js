require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('./models/Restaurant');

const restaurants = [
  {
    name: 'Royal Awadhi Darbar',
    cuisines: ['Biryani', 'North Indian', 'Mughlai', 'Kebabs'],
    rating: 4.5,
    deliveryTime: 28,
    costForTwo: 450,
    isPureVeg: false,
    offerText: '50% OFF UPTO ₹100',
    location: 'Indirapuram, Ghaziabad',
    fssai: '12723055000891',
    image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&q=80',
    menu: [
      { name: 'Hyderabadi Dum Chicken Biryani', price: 289, category: 'Biryani', isVeg: false, isBestseller: true, description: 'Slow-cooked aromatic basmati rice layered with marinated chicken & saffron.' },
      { name: 'Paneer Tikka Dum Biryani', price: 259, category: 'Biryani', isVeg: true, isBestseller: true, description: 'Char-grilled cottage cheese cubes layered with spiced dum rice.' },
      { name: 'Lucknowi Galouti Kebab (4 Pcs)', price: 220, category: 'Starters', isVeg: false, isBestseller: false, description: 'Melt-in-mouth minced kebabs served with ulte tawe ka paratha.' }
    ]
  },
  {
    name: 'Ghar Ki Rasoi - Pure Veg',
    cuisines: ['North Indian', 'Thalis', 'Homestyle', 'Healthy'],
    rating: 4.6,
    deliveryTime: 22,
    costForTwo: 280,
    isPureVeg: true,
    offerText: 'FREE DELIVERY',
    location: 'Vaishali, Ghaziabad',
    fssai: '12723055001124',
    image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&q=80',
    menu: [
      { name: 'TrueHomes Special Ghar Wali Thali', price: 199, category: 'Thalis', isVeg: true, isBestseller: true, description: 'Dal Tadka, Paneer Butter Masala, Jeera Rice, 3 Tawa Roti, Salad & Gulab Jamun.' },
      { name: 'Dal Makhani & 2 Butter Naan', price: 179, category: 'Combos', isVeg: true, isBestseller: true, description: '24-hour slow-simmered black lentils finished with white butter.' }
    ]
  },
  {
    name: 'Crust & Fire Woodfired Pizza',
    cuisines: ['Pizza', 'Italian', 'Pasta', 'Desserts'],
    rating: 4.3,
    deliveryTime: 32,
    costForTwo: 500,
    isPureVeg: false,
    offerText: 'FLAT ₹125 OFF',
    location: 'Kaushambi, Ghaziabad',
    fssai: '12723055004512',
    image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80',
    menu: [
      { name: 'Farmhouse Woodfired Margherita', price: 299, category: 'Pizza', isVeg: true, isBestseller: true, description: 'San Marzano tomato sauce, fresh mozzarella, basil & olive oil.' },
      { name: 'Smoked Peri-Peri Chicken Pizza', price: 369, category: 'Pizza', isVeg: false, isBestseller: true, description: 'Wood-roasted chicken, jalapeños, red paprika & mozzarella.' }
    ]
  },
  {
    name: 'Smash & Stack Burgers',
    cuisines: ['Burgers', 'Rolls', 'American', 'Fast Food'],
    rating: 4.4,
    deliveryTime: 24,
    costForTwo: 350,
    isPureVeg: false,
    offerText: '40% OFF UPTO ₹80',
    location: 'Indirapuram, Ghaziabad',
    fssai: '12723055006789',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80',
    menu: [
      { name: 'Crispy Paneer Makhani Burger', price: 169, category: 'Burgers', isVeg: true, isBestseller: true, description: 'Crunchy spiced paneer patty drizzled with smoky makhani sauce.' },
      { name: 'Double Smash Chicken Cheese Burger', price: 219, category: 'Burgers', isVeg: false, isBestseller: true, description: 'Two seared chicken patties, melted cheddar, pickles & house sauce.' }
    ]
  },
  {
    name: 'Dakshin Spice Express',
    cuisines: ['South Indian', 'Healthy', 'Beverages'],
    rating: 4.7,
    deliveryTime: 20,
    costForTwo: 240,
    isPureVeg: true,
    offerText: 'FREE DELIVERY',
    location: 'Sector 62, Noida',
    fssai: '12723055007741',
    image: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=800&q=80',
    menu: [
      { name: 'Ghee Roast Masala Dosa', price: 149, category: 'Dosas', isVeg: true, isBestseller: true, description: 'Crispy golden crepe roasted in pure cow ghee with spiced potato masala.' },
      { name: 'Steamed Idli & Medu Vada Platter', price: 119, category: 'Breakfast', isVeg: true, isBestseller: false, description: '2 fluffy idlis & 1 crispy vada served with piping hot sambar & 3 chutneys.' }
    ]
  },
  {
    name: 'Wok & Dragon Asian Kitchen',
    cuisines: ['Chinese', 'Rolls', 'Asian', 'Desserts'],
    rating: 4.2,
    deliveryTime: 34,
    costForTwo: 420,
    isPureVeg: false,
    offerText: '₹150 OFF ABOVE ₹499',
    location: 'Indirapuram, Ghaziabad',
    fssai: '12723055009102',
    image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800&q=80',
    menu: [
      { name: 'Chilli Garlic Hakka Noodles Bowl', price: 189, category: 'Mains', isVeg: true, isBestseller: true, description: 'Wok-tossed noodles with crisp vegetables, burnt garlic & soy glaze.' },
      { name: 'Kung Pao Chicken & Fried Rice', price: 249, category: 'Combos', isVeg: false, isBestseller: true, description: 'Diced chicken tossed with roasted peanuts, dried chillies & egg fried rice.' }
    ]
  }
];

async function seedDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await Restaurant.deleteMany({});
    await Restaurant.insertMany(restaurants);
    console.log('All 6 TrueHomes kitchens seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  }
}

seedDB();