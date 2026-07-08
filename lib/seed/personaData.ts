// Static reference datasets for the persona generator (lib/seed/personas.ts).
// Pure data, no rng — every table here is consumed through a seeded stream in
// the generator, so the same master seed always meets the same rows in the
// same order. Names grounded in US SSA popular-name data (spread across
// decades so ages vary) and US Census Bureau most-common-surname data;
// occupations grounded in US BLS OEWS / O*NET common-job data.

// --- Professions -------------------------------------------------------------

export type ProfessionCategory =
  | "Healthcare"
  | "Education"
  | "Retail"
  | "Food Service"
  | "Construction & Trades"
  | "Transportation"
  | "Office & Admin"
  | "Technology"
  | "Finance"
  | "Legal"
  | "Public Safety"
  | "Arts & Media"
  | "Science"
  | "Manufacturing"
  | "Personal Care"
  | "Agriculture"
  | "Management"
  | "Sales"
  | "Hospitality"
  | "Other";

// Coarse building-use tag — the employment pass maps these onto Archetype +
// DistrictCharacter to pick a plausible work building for each employed adult.
export type WorkplaceType =
  | "office"
  | "hospital"
  | "school"
  | "retail"
  | "restaurant"
  | "factory"
  | "warehouse"
  | "civic"
  | "home"
  | "outdoor"
  | "transit"
  | "studio"
  | "lab"
  | "shop";

// Typical entry education — 0 none/on-the-job, 1 high school, 2 some
// college/associate/trade, 3 bachelor's, 4 graduate/professional.
export type EducationTier = 0 | 1 | 2 | 3 | 4;

export type Profession = {
  title: string;
  category: ProfessionCategory;
  educationTier: EducationTier;
  workplaceType: WorkplaceType;
};

// --- First names ---------------------------------------------------------
// Mix of decades: classic mid-century (Robert, William, Mary, Patricia)
// through current top-of-chart (Liam, Noah, Olivia, Emma) — so a 70-year-old
// Dorothy and a 6-year-old Liam both read as the right generation.

export const MASCULINE_FIRST_NAMES: string[] = [
  "Robert", "William", "James", "John", "Michael",
  "David", "Richard", "Joseph", "Thomas", "Charles",
  "Christopher", "Daniel", "Matthew", "Anthony", "Mark",
  "Donald", "Steven", "Paul", "Andrew", "Kenneth",
  "George", "Edward", "Brian", "Kevin", "Ronald",
  "Timothy", "Jason", "Jeffrey", "Gary", "Frank",
  "Raymond", "Gregory", "Patrick", "Jack", "Henry",
  "Benjamin", "Samuel", "Alexander", "Nicholas", "Ryan",
  "Nathan", "Jacob", "Ethan", "Logan", "Mason",
  "Elijah", "Noah", "Liam", "Lucas", "Owen",
  // 2026-07-08 growth (multi-household round): +25, same era spread.
  "Aaron", "Adam", "Alan", "Arthur", "Austin",
  "Caleb", "Carl", "Christian", "Dennis", "Douglas",
  "Dylan", "Eric", "Gabriel", "Harold", "Isaac",
  "Jesse", "Jonathan", "Jordan", "Joshua", "Juan",
  "Justin", "Keith", "Kyle", "Miguel", "Tyler",
];

export const FEMININE_FIRST_NAMES: string[] = [
  "Mary", "Patricia", "Linda", "Barbara", "Elizabeth",
  "Jennifer", "Susan", "Margaret", "Dorothy", "Karen",
  "Nancy", "Betty", "Sandra", "Carol", "Sharon",
  "Deborah", "Donna", "Ruth", "Cynthia", "Kathleen",
  "Angela", "Brenda", "Pamela", "Janet", "Virginia",
  "Lisa", "Michelle", "Melissa", "Stephanie", "Rebecca",
  "Laura", "Amanda", "Nicole", "Rachel", "Heather",
  "Christina", "Samantha", "Ashley", "Kimberly", "Jessica",
  "Emily", "Hannah", "Madison", "Abigail", "Grace",
  "Victoria", "Emma", "Olivia", "Sophia", "Isabella",
  // 2026-07-08 growth (multi-household round): +25, same era spread.
  "Alice", "Amber", "Amy", "Anna", "Ava",
  "Carolyn", "Catherine", "Charlotte", "Chloe", "Christine",
  "Danielle", "Diana", "Frances", "Helen", "Jacqueline",
  "Joan", "Joyce", "Julia", "Julie", "Katherine",
  "Kayla", "Lauren", "Megan", "Mia", "Natalie",
];

// --- Surnames --------------------------------------------------------------
// The 200 most common US surnames per the 2010 Census, in rank order
// (2026-07-08: doubled from 100 for the multi-household round — 17k
// households over 100 surnames repeated hard).

export const LAST_NAMES: string[] = [
  "Smith", "Johnson", "Williams", "Brown", "Jones",
  "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris",
  "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
  "Walker", "Young", "Allen", "King", "Wright",
  "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall",
  "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
  "Gomez", "Phillips", "Evans", "Turner", "Diaz",
  "Parker", "Cruz", "Edwards", "Collins", "Reyes",
  "Stewart", "Morris", "Morales", "Murphy", "Cook",
  "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper",
  "Peterson", "Bailey", "Reed", "Kelly", "Howard",
  "Ramos", "Kim", "Cox", "Ward", "Richardson",
  "Watson", "Brooks", "Chavez", "Wood", "James",
  "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes",
  "Price", "Alvarez", "Castillo", "Sanders", "Patel",
  "Myers", "Long", "Ross", "Foster", "Jimenez",
  "Powell", "Jenkins", "Perry", "Russell", "Sullivan",
  "Bell", "Coleman", "Butler", "Henderson", "Barnes",
  "Gonzales", "Fisher", "Vasquez", "Simmons", "Romero",
  "Jordan", "Patterson", "Alexander", "Hamilton", "Graham",
  "Reynolds", "Griffin", "Wallace", "Moreno", "West",
  "Cole", "Hayes", "Bryant", "Herrera", "Gibson",
  "Ellis", "Tran", "Medina", "Aguilar", "Stevens",
  "Murray", "Ford", "Castro", "Marshall", "Owens",
  "Harrison", "Fernandez", "McDonald", "Woods", "Washington",
  "Kennedy", "Wells", "Vargas", "Henry", "Chen",
  "Freeman", "Webb", "Tucker", "Guzman", "Burns",
  "Crawford", "Olson", "Simpson", "Porter", "Hunter",
  "Gordon", "Mendez", "Silva", "Shaw", "Snyder",
  "Mason", "Dixon", "Munoz", "Hunt", "Hicks",
  "Holmes", "Palmer", "Wagner", "Black", "Robertson",
  "Boyd", "Rose", "Stone", "Salazar", "Fox",
  "Warren", "Mills", "Meyer", "Rice", "Schmidt",
  "Garza", "Daniels", "Ferguson", "Nichols", "Stephens",
  "Soto", "Weaver", "Ryan", "Gardner", "Payne",
  "Grant", "Dunn", "Kelley", "Spencer", "Hawkins",
];

// --- Professions -----------------------------------------------------------
// 200 common US occupations spanning everyday work through professional roles.

export const PROFESSIONS: Profession[] = [
  // Healthcare
  { title: "Registered Nurse", category: "Healthcare", educationTier: 3, workplaceType: "hospital" },
  { title: "Licensed Practical Nurse", category: "Healthcare", educationTier: 2, workplaceType: "hospital" },
  { title: "Certified Nursing Assistant", category: "Healthcare", educationTier: 1, workplaceType: "hospital" },
  { title: "Home Health Aide", category: "Healthcare", educationTier: 0, workplaceType: "home" },
  { title: "Medical Assistant", category: "Healthcare", educationTier: 2, workplaceType: "hospital" },
  { title: "Physician", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Surgeon", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Pediatrician", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Dentist", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Dental Hygienist", category: "Healthcare", educationTier: 2, workplaceType: "hospital" },
  { title: "Pharmacist", category: "Healthcare", educationTier: 4, workplaceType: "retail" },
  { title: "Pharmacy Technician", category: "Healthcare", educationTier: 1, workplaceType: "retail" },
  { title: "Physical Therapist", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Radiologic Technologist", category: "Healthcare", educationTier: 2, workplaceType: "hospital" },
  { title: "Paramedic", category: "Healthcare", educationTier: 2, workplaceType: "hospital" },
  { title: "Phlebotomist", category: "Healthcare", educationTier: 1, workplaceType: "hospital" },
  { title: "Nurse Practitioner", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Occupational Therapist", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Veterinarian", category: "Healthcare", educationTier: 4, workplaceType: "hospital" },
  { title: "Optician", category: "Healthcare", educationTier: 2, workplaceType: "retail" },

  // Education
  { title: "Elementary School Teacher", category: "Education", educationTier: 3, workplaceType: "school" },
  { title: "Middle School Teacher", category: "Education", educationTier: 3, workplaceType: "school" },
  { title: "High School Teacher", category: "Education", educationTier: 3, workplaceType: "school" },
  { title: "Preschool Teacher", category: "Education", educationTier: 2, workplaceType: "school" },
  { title: "Special Education Teacher", category: "Education", educationTier: 3, workplaceType: "school" },
  { title: "Teaching Assistant", category: "Education", educationTier: 2, workplaceType: "school" },
  { title: "Substitute Teacher", category: "Education", educationTier: 3, workplaceType: "school" },
  { title: "School Principal", category: "Education", educationTier: 4, workplaceType: "school" },
  { title: "School Counselor", category: "Education", educationTier: 4, workplaceType: "school" },
  { title: "College Professor", category: "Education", educationTier: 4, workplaceType: "school" },
  { title: "Librarian", category: "Education", educationTier: 4, workplaceType: "civic" },
  { title: "Tutor", category: "Education", educationTier: 3, workplaceType: "school" },

  // Retail
  { title: "Cashier", category: "Retail", educationTier: 1, workplaceType: "retail" },
  { title: "Retail Salesperson", category: "Retail", educationTier: 1, workplaceType: "retail" },
  { title: "Stock Clerk", category: "Retail", educationTier: 0, workplaceType: "retail" },
  { title: "Sales Associate", category: "Retail", educationTier: 1, workplaceType: "retail" },
  { title: "Grocery Clerk", category: "Retail", educationTier: 1, workplaceType: "retail" },
  { title: "Courtesy Clerk", category: "Retail", educationTier: 0, workplaceType: "retail" },
  { title: "Florist", category: "Retail", educationTier: 1, workplaceType: "shop" },
  { title: "Butcher", category: "Retail", educationTier: 1, workplaceType: "shop" },
  { title: "Jeweler", category: "Retail", educationTier: 2, workplaceType: "shop" },
  { title: "Retail Buyer", category: "Retail", educationTier: 3, workplaceType: "office" },
  { title: "Visual Merchandiser", category: "Retail", educationTier: 2, workplaceType: "retail" },
  { title: "Parts Salesperson", category: "Retail", educationTier: 1, workplaceType: "shop" },

  // Food Service
  { title: "Fast Food Worker", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Cook", category: "Food Service", educationTier: 1, workplaceType: "restaurant" },
  { title: "Line Cook", category: "Food Service", educationTier: 1, workplaceType: "restaurant" },
  { title: "Chef", category: "Food Service", educationTier: 2, workplaceType: "restaurant" },
  { title: "Server", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Bartender", category: "Food Service", educationTier: 1, workplaceType: "restaurant" },
  { title: "Barista", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Dishwasher", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Host", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Baker", category: "Food Service", educationTier: 1, workplaceType: "shop" },
  { title: "Food Preparation Worker", category: "Food Service", educationTier: 0, workplaceType: "restaurant" },
  { title: "Restaurant Manager", category: "Food Service", educationTier: 2, workplaceType: "restaurant" },

  // Construction & Trades
  { title: "Construction Laborer", category: "Construction & Trades", educationTier: 1, workplaceType: "outdoor" },
  { title: "Carpenter", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Electrician", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Plumber", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Painter", category: "Construction & Trades", educationTier: 1, workplaceType: "outdoor" },
  { title: "Roofer", category: "Construction & Trades", educationTier: 1, workplaceType: "outdoor" },
  { title: "Welder", category: "Construction & Trades", educationTier: 2, workplaceType: "factory" },
  { title: "HVAC Technician", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Mason", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Heavy Equipment Operator", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },
  { title: "Drywall Installer", category: "Construction & Trades", educationTier: 1, workplaceType: "outdoor" },
  { title: "Sheet Metal Worker", category: "Construction & Trades", educationTier: 2, workplaceType: "factory" },
  { title: "Construction Manager", category: "Construction & Trades", educationTier: 3, workplaceType: "outdoor" },
  { title: "Flooring Installer", category: "Construction & Trades", educationTier: 1, workplaceType: "outdoor" },
  { title: "Glazier", category: "Construction & Trades", educationTier: 2, workplaceType: "outdoor" },

  // Transportation
  { title: "Truck Driver", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Delivery Driver", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Bus Driver", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Taxi Driver", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Rideshare Driver", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Forklift Operator", category: "Transportation", educationTier: 1, workplaceType: "warehouse" },
  { title: "Warehouse Worker", category: "Transportation", educationTier: 0, workplaceType: "warehouse" },
  { title: "Courier", category: "Transportation", educationTier: 0, workplaceType: "transit" },
  { title: "Airline Pilot", category: "Transportation", educationTier: 3, workplaceType: "transit" },
  { title: "Flight Attendant", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Railroad Conductor", category: "Transportation", educationTier: 1, workplaceType: "transit" },
  { title: "Mail Carrier", category: "Transportation", educationTier: 1, workplaceType: "transit" },

  // Office & Admin
  { title: "Administrative Assistant", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Receptionist", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Office Clerk", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Customer Service Representative", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Data Entry Clerk", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Secretary", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Bookkeeper", category: "Office & Admin", educationTier: 2, workplaceType: "office" },
  { title: "Human Resources Specialist", category: "Office & Admin", educationTier: 3, workplaceType: "office" },
  { title: "Executive Assistant", category: "Office & Admin", educationTier: 2, workplaceType: "office" },
  { title: "Office Manager", category: "Office & Admin", educationTier: 2, workplaceType: "office" },
  { title: "Payroll Clerk", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "File Clerk", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Billing Clerk", category: "Office & Admin", educationTier: 1, workplaceType: "office" },
  { title: "Call Center Representative", category: "Office & Admin", educationTier: 1, workplaceType: "office" },

  // Technology
  { title: "Software Developer", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "Web Developer", category: "Technology", educationTier: 2, workplaceType: "office" },
  { title: "Systems Administrator", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "Network Engineer", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "Data Scientist", category: "Technology", educationTier: 4, workplaceType: "office" },
  { title: "IT Support Specialist", category: "Technology", educationTier: 2, workplaceType: "office" },
  { title: "Database Administrator", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "Cybersecurity Analyst", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "DevOps Engineer", category: "Technology", educationTier: 3, workplaceType: "office" },
  { title: "UX Designer", category: "Technology", educationTier: 3, workplaceType: "studio" },
  { title: "Quality Assurance Tester", category: "Technology", educationTier: 2, workplaceType: "office" },
  { title: "Computer Programmer", category: "Technology", educationTier: 3, workplaceType: "office" },

  // Finance
  { title: "Accountant", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Financial Analyst", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Bank Teller", category: "Finance", educationTier: 1, workplaceType: "office" },
  { title: "Loan Officer", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Financial Advisor", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Auditor", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Insurance Underwriter", category: "Finance", educationTier: 3, workplaceType: "office" },
  { title: "Actuary", category: "Finance", educationTier: 4, workplaceType: "office" },
  { title: "Tax Preparer", category: "Finance", educationTier: 2, workplaceType: "office" },

  // Legal
  { title: "Lawyer", category: "Legal", educationTier: 4, workplaceType: "office" },
  { title: "Paralegal", category: "Legal", educationTier: 2, workplaceType: "office" },
  { title: "Legal Secretary", category: "Legal", educationTier: 1, workplaceType: "office" },
  { title: "Judge", category: "Legal", educationTier: 4, workplaceType: "civic" },
  { title: "Court Clerk", category: "Legal", educationTier: 1, workplaceType: "civic" },

  // Public Safety
  { title: "Police Officer", category: "Public Safety", educationTier: 2, workplaceType: "civic" },
  { title: "Firefighter", category: "Public Safety", educationTier: 2, workplaceType: "civic" },
  { title: "Correctional Officer", category: "Public Safety", educationTier: 1, workplaceType: "civic" },
  { title: "Security Guard", category: "Public Safety", educationTier: 1, workplaceType: "office" },
  { title: "Detective", category: "Public Safety", educationTier: 2, workplaceType: "civic" },
  { title: "Emergency Dispatcher", category: "Public Safety", educationTier: 1, workplaceType: "civic" },
  { title: "Sheriff's Deputy", category: "Public Safety", educationTier: 2, workplaceType: "civic" },
  { title: "Border Patrol Agent", category: "Public Safety", educationTier: 2, workplaceType: "outdoor" },
  { title: "Crossing Guard", category: "Public Safety", educationTier: 0, workplaceType: "outdoor" },

  // Arts & Media
  { title: "Graphic Designer", category: "Arts & Media", educationTier: 3, workplaceType: "studio" },
  { title: "Photographer", category: "Arts & Media", educationTier: 2, workplaceType: "studio" },
  { title: "Journalist", category: "Arts & Media", educationTier: 3, workplaceType: "office" },
  { title: "Musician", category: "Arts & Media", educationTier: 2, workplaceType: "studio" },
  { title: "Actor", category: "Arts & Media", educationTier: 2, workplaceType: "studio" },
  { title: "Writer", category: "Arts & Media", educationTier: 3, workplaceType: "home" },
  { title: "Video Editor", category: "Arts & Media", educationTier: 2, workplaceType: "studio" },
  { title: "Interior Designer", category: "Arts & Media", educationTier: 3, workplaceType: "studio" },
  { title: "Art Director", category: "Arts & Media", educationTier: 3, workplaceType: "studio" },
  { title: "Fashion Designer", category: "Arts & Media", educationTier: 3, workplaceType: "studio" },

  // Science
  { title: "Chemist", category: "Science", educationTier: 4, workplaceType: "lab" },
  { title: "Biologist", category: "Science", educationTier: 4, workplaceType: "lab" },
  { title: "Civil Engineer", category: "Science", educationTier: 3, workplaceType: "office" },
  { title: "Mechanical Engineer", category: "Science", educationTier: 3, workplaceType: "office" },
  { title: "Environmental Scientist", category: "Science", educationTier: 3, workplaceType: "lab" },
  { title: "Lab Technician", category: "Science", educationTier: 2, workplaceType: "lab" },
  { title: "Research Scientist", category: "Science", educationTier: 4, workplaceType: "lab" },
  { title: "Geologist", category: "Science", educationTier: 4, workplaceType: "outdoor" },

  // Manufacturing
  { title: "Assembly Line Worker", category: "Manufacturing", educationTier: 1, workplaceType: "factory" },
  { title: "Machine Operator", category: "Manufacturing", educationTier: 1, workplaceType: "factory" },
  { title: "Machinist", category: "Manufacturing", educationTier: 2, workplaceType: "factory" },
  { title: "Production Worker", category: "Manufacturing", educationTier: 0, workplaceType: "factory" },
  { title: "Quality Control Inspector", category: "Manufacturing", educationTier: 1, workplaceType: "factory" },
  { title: "Industrial Machinery Mechanic", category: "Manufacturing", educationTier: 2, workplaceType: "factory" },
  { title: "Packaging Worker", category: "Manufacturing", educationTier: 0, workplaceType: "factory" },
  { title: "CNC Operator", category: "Manufacturing", educationTier: 2, workplaceType: "factory" },
  { title: "Tool and Die Maker", category: "Manufacturing", educationTier: 2, workplaceType: "factory" },
  { title: "Plant Supervisor", category: "Manufacturing", educationTier: 2, workplaceType: "factory" },

  // Personal Care
  { title: "Hairstylist", category: "Personal Care", educationTier: 2, workplaceType: "shop" },
  { title: "Barber", category: "Personal Care", educationTier: 2, workplaceType: "shop" },
  { title: "Cosmetologist", category: "Personal Care", educationTier: 2, workplaceType: "shop" },
  { title: "Nail Technician", category: "Personal Care", educationTier: 1, workplaceType: "shop" },
  { title: "Massage Therapist", category: "Personal Care", educationTier: 2, workplaceType: "shop" },
  { title: "Childcare Worker", category: "Personal Care", educationTier: 1, workplaceType: "home" },
  { title: "Fitness Trainer", category: "Personal Care", educationTier: 2, workplaceType: "studio" },
  { title: "Esthetician", category: "Personal Care", educationTier: 2, workplaceType: "shop" },

  // Agriculture
  { title: "Farmworker", category: "Agriculture", educationTier: 0, workplaceType: "outdoor" },
  { title: "Farmer", category: "Agriculture", educationTier: 1, workplaceType: "outdoor" },
  { title: "Rancher", category: "Agriculture", educationTier: 1, workplaceType: "outdoor" },
  { title: "Agricultural Equipment Operator", category: "Agriculture", educationTier: 1, workplaceType: "outdoor" },
  { title: "Landscaper", category: "Agriculture", educationTier: 1, workplaceType: "outdoor" },
  { title: "Groundskeeper", category: "Agriculture", educationTier: 0, workplaceType: "outdoor" },

  // Management
  { title: "General Manager", category: "Management", educationTier: 3, workplaceType: "office" },
  { title: "Operations Manager", category: "Management", educationTier: 3, workplaceType: "office" },
  { title: "Project Manager", category: "Management", educationTier: 3, workplaceType: "office" },
  { title: "Sales Manager", category: "Management", educationTier: 3, workplaceType: "office" },
  { title: "Marketing Manager", category: "Management", educationTier: 3, workplaceType: "office" },
  { title: "Retail Store Manager", category: "Management", educationTier: 2, workplaceType: "retail" },
  { title: "Warehouse Manager", category: "Management", educationTier: 2, workplaceType: "warehouse" },

  // Sales
  { title: "Real Estate Agent", category: "Sales", educationTier: 2, workplaceType: "office" },
  { title: "Insurance Sales Agent", category: "Sales", educationTier: 2, workplaceType: "office" },
  { title: "Sales Representative", category: "Sales", educationTier: 2, workplaceType: "office" },
  { title: "Telemarketer", category: "Sales", educationTier: 1, workplaceType: "office" },
  { title: "Advertising Sales Agent", category: "Sales", educationTier: 3, workplaceType: "office" },
  { title: "Car Salesperson", category: "Sales", educationTier: 1, workplaceType: "shop" },

  // Hospitality
  { title: "Hotel Front Desk Clerk", category: "Hospitality", educationTier: 1, workplaceType: "office" },
  { title: "Housekeeper", category: "Hospitality", educationTier: 0, workplaceType: "home" },
  { title: "Concierge", category: "Hospitality", educationTier: 1, workplaceType: "office" },
  { title: "Event Planner", category: "Hospitality", educationTier: 3, workplaceType: "office" },
  { title: "Travel Agent", category: "Hospitality", educationTier: 2, workplaceType: "office" },
  { title: "Tour Guide", category: "Hospitality", educationTier: 1, workplaceType: "outdoor" },
  { title: "Bellhop", category: "Hospitality", educationTier: 0, workplaceType: "office" },
  { title: "Casino Dealer", category: "Hospitality", educationTier: 1, workplaceType: "office" },

  // Other
  { title: "Janitor", category: "Other", educationTier: 0, workplaceType: "office" },
  { title: "Custodian", category: "Other", educationTier: 0, workplaceType: "school" },
  { title: "Maintenance Worker", category: "Other", educationTier: 1, workplaceType: "office" },
  { title: "Pest Control Technician", category: "Other", educationTier: 1, workplaceType: "outdoor" },
  { title: "Funeral Director", category: "Other", educationTier: 3, workplaceType: "civic" },
];
// Counts: MASCULINE_FIRST_NAMES 75, FEMININE_FIRST_NAMES 75, LAST_NAMES 200,
// PROFESSIONS 200 (verified by scripts/personaCheck.ts).

// --- Astrology ---------------------------------------------------------------

export type WesternSign = {
  name: string;
  symbol: string; // unicode glyph for badges
  element: "Fire" | "Earth" | "Air" | "Water";
  modality: "Cardinal" | "Fixed" | "Mutable";
  // Start of the sign's window as {month, day} (1-based month). A sign runs
  // from its start to the day before the next sign's start.
  startMonth: number;
  startDay: number;
};

// Ordered by start date within the calendar year (Capricorn wraps the year
// boundary and sits first with its January window; the lookup handles the wrap).
export const WESTERN_ZODIAC: WesternSign[] = [
  { name: "Capricorn", symbol: "♑", element: "Earth", modality: "Cardinal", startMonth: 12, startDay: 22 },
  { name: "Aquarius", symbol: "♒", element: "Air", modality: "Fixed", startMonth: 1, startDay: 20 },
  { name: "Pisces", symbol: "♓", element: "Water", modality: "Mutable", startMonth: 2, startDay: 19 },
  { name: "Aries", symbol: "♈", element: "Fire", modality: "Cardinal", startMonth: 3, startDay: 21 },
  { name: "Taurus", symbol: "♉", element: "Earth", modality: "Fixed", startMonth: 4, startDay: 20 },
  { name: "Gemini", symbol: "♊", element: "Air", modality: "Mutable", startMonth: 5, startDay: 21 },
  { name: "Cancer", symbol: "♋", element: "Water", modality: "Cardinal", startMonth: 6, startDay: 21 },
  { name: "Leo", symbol: "♌", element: "Fire", modality: "Fixed", startMonth: 7, startDay: 23 },
  { name: "Virgo", symbol: "♍", element: "Earth", modality: "Mutable", startMonth: 8, startDay: 23 },
  { name: "Libra", symbol: "♎", element: "Air", modality: "Cardinal", startMonth: 9, startDay: 23 },
  { name: "Scorpio", symbol: "♏", element: "Water", modality: "Fixed", startMonth: 10, startDay: 23 },
  { name: "Sagittarius", symbol: "♐", element: "Fire", modality: "Mutable", startMonth: 11, startDay: 22 },
];

// One-line folk readings for the badge hovers — flavour, not doctrine. Kept
// concrete and mildly wry so they read like the rest of the story layer.
export const WESTERN_SIGN_TRAITS: Record<string, string> = {
  Aries: "First through every door; apologizes later, if at all.",
  Taurus: "Immovable once settled; keeps the good chair and the grudge.",
  Gemini: "Two opinions, both held sincerely, often simultaneously.",
  Cancer: "Guards the people they feed; remembers every kindness and its date.",
  Leo: "Runs warm and center-stage; generous when watched, and usually watched.",
  Virgo: "Notices the crooked picture frame from across the room. Fixes it.",
  Libra: "Weighs everything twice; will split the check to the cent, kindly.",
  Scorpio: "Says less than they know. Knows more than is comfortable.",
  Sagittarius: "Already halfway out the door to somewhere with better weather.",
  Capricorn: "Climbs slowly, arrives anyway; keeps receipts going back years.",
  Aquarius: "On the block's wavelength, but tuned two stations over.",
  Pisces: "Porous to other people's weather; dreams with the window open.",
};

export const CHINESE_ANIMAL_TRAITS: Record<(typeof CHINESE_ANIMALS)[number], string> = {
  Rat: "quick, resourceful, first to the opportunity",
  Ox: "steady, patient, carries what others put down",
  Tiger: "bold, restless, allergic to instructions",
  Rabbit: "gentle, diplomatic, keeps the peace and the secrets",
  Dragon: "confident, magnetic, arrives with weather",
  Snake: "observant, private, three moves ahead",
  Horse: "energetic, independent, hates a closed gate",
  Goat: "kind, artistic, softest heart on the floor",
  Monkey: "clever, playful, negotiates with everyone",
  Rooster: "punctual, exacting, says the thing out loud",
  Dog: "loyal, fair, first to notice who's missing",
  Pig: "generous, honest, keeps the table full",
};

export const CHINESE_ELEMENT_TRAITS: Record<(typeof CHINESE_ELEMENTS)[number], string> = {
  Wood: "growth-minded",
  Fire: "runs hot",
  Earth: "grounded",
  Metal: "unbending",
  Water: "adaptable",
};

// Sun-sign lookup from month (1-12) + day. Tropical dates, fixed table — close
// enough for character flavour; we don't model year-to-year cusp shifts.
export function westernSignFor(month: number, day: number): WesternSign {
  // Walk the calendar-ordered signs (Aquarius..Sagittarius); anything earlier
  // than Aquarius' Jan 20 start falls into Capricorn's year-wrapping window.
  let sign = WESTERN_ZODIAC[0];
  for (let i = 1; i < WESTERN_ZODIAC.length; i++) {
    const s = WESTERN_ZODIAC[i];
    if (month > s.startMonth || (month === s.startMonth && day >= s.startDay)) sign = s;
  }
  if (month === 12 && day >= 22) sign = WESTERN_ZODIAC[0];
  return sign;
}

// Chinese zodiac: 12 animals × 5 elements, both cycling by year. 1924 was the
// wood-rat year that opened the current sexagenary cycle. We key off the
// calendar year only — Lunar New Year lands late Jan/mid Feb, so Jan/early-Feb
// birthdays can be off by one animal; acceptable for character flavour and
// noted in the persona wiki doc.
export const CHINESE_ANIMALS = [
  "Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
  "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig",
] as const;

export const CHINESE_ANIMAL_GLYPHS: Record<(typeof CHINESE_ANIMALS)[number], string> = {
  Rat: "🐀", Ox: "🐂", Tiger: "🐅", Rabbit: "🐇", Dragon: "🐉", Snake: "🐍",
  Horse: "🐎", Goat: "🐐", Monkey: "🐒", Rooster: "🐓", Dog: "🐕", Pig: "🐖",
};

export const CHINESE_ELEMENTS = ["Wood", "Fire", "Earth", "Metal", "Water"] as const;

export type ChineseSign = {
  animal: (typeof CHINESE_ANIMALS)[number];
  element: (typeof CHINESE_ELEMENTS)[number];
};

export function chineseSignFor(year: number): ChineseSign {
  const offset = ((year - 1924) % 60 + 60) % 60;
  return {
    animal: CHINESE_ANIMALS[offset % 12],
    // Element advances every two years (wood-wood, fire-fire, ...).
    element: CHINESE_ELEMENTS[Math.floor((offset % 10) / 2)],
  };
}

// --- Myers-Briggs ------------------------------------------------------------

// Rough population frequencies per axis (Myers & McCaulley estimates): I/E
// near-even, S over N, F slightly over T overall, J over P. Drawn per-axis so
// all 16 types occur at plausible rates.
export const MBTI_AXIS_WEIGHTS = {
  I: 0.51, // vs E
  S: 0.67, // vs N
  T: 0.46, // vs F (flipped per gender-ish noise in the generator? no — keep global)
  J: 0.54, // vs P
} as const;

// One-liners for the MBTI badge hover — nickname + what it's like to live
// next door to one.
export const MBTI_DESCRIPTIONS: Record<string, string> = {
  ISTJ: "Duty-first and by-the-book; the neighbor whose trash goes out on time, every time.",
  ISFJ: "Quietly keeps everyone fed and remembered; notices when you don't wave back.",
  INFJ: "Reads the room, then the subtext, then the things nobody said.",
  INTJ: "Has a plan, a backup plan, and opinions about your plan.",
  ISTP: "Takes it apart to see why; puts it back better, mostly.",
  ISFP: "Soft-spoken with loud taste; the apartment smells like something baking.",
  INFP: "Runs on ideals and second chances; keeps every letter.",
  INTP: "Follows the interesting question wherever it goes, dishes notwithstanding.",
  ESTP: "Acts first, negotiates after; great in a blackout.",
  ESFP: "The hallway is a stage and the mail run is an entrance.",
  ENFP: "Befriends the whole floor by accident; finishes a third of it.",
  ENTP: "Argues both sides for sport; wins at least one.",
  ESTJ: "Organizes the block party and the block; keeps a clipboard.",
  ESFJ: "Knows every birthday on the street and most of the business.",
  ENFJ: "Everyone's confidant; carries more secrets than the mail carrier.",
  ENTJ: "Runs whatever room they're in, including the elevator.",
};

export const MBTI_NICKNAMES: Record<string, string> = {
  ISTJ: "The Inspector", ISFJ: "The Protector", INFJ: "The Counselor", INTJ: "The Architect",
  ISTP: "The Craftsman", ISFP: "The Composer", INFP: "The Healer", INTP: "The Logician",
  ESTP: "The Dynamo", ESFP: "The Performer", ENFP: "The Champion", ENTP: "The Visionary",
  ESTJ: "The Supervisor", ESFJ: "The Provider", ENFJ: "The Teacher", ENTJ: "The Commander",
};

// --- Demographics ------------------------------------------------------------

// Census-adjacent city mix. Weights are relative (normalised by the generator).
export type Ethnicity =
  | "White"
  | "Black"
  | "Hispanic or Latino"
  | "East Asian"
  | "South Asian"
  | "Southeast Asian"
  | "Middle Eastern"
  | "Native American"
  | "Pacific Islander"
  | "Multiracial";

export const ETHNICITY_WEIGHTS: Array<{ ethnicity: Ethnicity; weight: number }> = [
  { ethnicity: "White", weight: 0.46 },
  { ethnicity: "Hispanic or Latino", weight: 0.2 },
  { ethnicity: "Black", weight: 0.14 },
  { ethnicity: "East Asian", weight: 0.05 },
  { ethnicity: "South Asian", weight: 0.03 },
  { ethnicity: "Southeast Asian", weight: 0.03 },
  { ethnicity: "Middle Eastern", weight: 0.02 },
  { ethnicity: "Native American", weight: 0.01 },
  { ethnicity: "Pacific Islander", weight: 0.005 },
  { ethnicity: "Multiracial", weight: 0.055 },
];

// Light surname-ethnicity affinity: indices into LAST_NAMES that read as
// strongly associated with a group. The generator prefers (not forces) an
// affine surname ~70% of the time, so names correlate without being a rule.
export const SURNAME_AFFINITY: Partial<Record<Ethnicity, string[]>> = {
  "Hispanic or Latino": [
    "Garcia", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Perez",
    "Sanchez", "Ramirez", "Torres", "Flores", "Rivera", "Gomez", "Diaz", "Cruz",
    "Reyes", "Morales", "Gutierrez", "Ortiz", "Ramos", "Chavez", "Mendoza",
    "Ruiz", "Alvarez", "Castillo", "Jimenez",
    // Ranks 101-200 additions (2026-07-08 pool growth).
    "Gonzales", "Vasquez", "Romero", "Moreno", "Herrera", "Medina", "Aguilar",
    "Castro", "Fernandez", "Vargas", "Guzman", "Mendez", "Munoz", "Salazar",
    "Garza", "Soto", "Silva",
  ],
  "East Asian": ["Kim", "Lee", "Chen"],
  "Southeast Asian": ["Nguyen", "Tran"],
  "South Asian": ["Patel"],
};

export type GenderIdentity =
  | "cis man"
  | "cis woman"
  | "trans man"
  | "trans woman"
  | "nonbinary";

export const PRONOUNS: Record<GenderIdentity, string> = {
  "cis man": "he/him",
  "cis woman": "she/her",
  "trans man": "he/him",
  "trans woman": "she/her",
  nonbinary: "they/them",
};

// --- Education ---------------------------------------------------------------

// Display labels per attained level; the generator picks attained level from
// the profession's educationTier ± seeded variance.
export const EDUCATION_LABELS: Record<EducationTier, string[]> = {
  0: ["No formal credential", "Some high school"],
  1: ["High school diploma", "GED"],
  2: ["Associate degree", "Trade certification", "Some college"],
  3: ["Bachelor's degree"],
  4: ["Master's degree", "Doctorate", "Professional degree"],
};

// Local institutions are named by the naming layer (naming.ts) so they carry
// the city's own name; these are the generic degree-subject pools.
export const DEGREE_SUBJECTS: Partial<Record<ProfessionCategory, string[]>> = {
  Healthcare: ["Nursing", "Biology", "Public Health", "Pre-Med"],
  Education: ["Education", "English", "History", "Mathematics"],
  Technology: ["Computer Science", "Information Systems", "Software Engineering"],
  Finance: ["Accounting", "Finance", "Economics", "Business Administration"],
  Legal: ["Political Science", "Law", "Criminal Justice"],
  Science: ["Chemistry", "Biology", "Physics", "Environmental Science", "Geology"],
  "Arts & Media": ["Fine Arts", "Graphic Design", "Journalism", "Film Studies", "Music"],
  Management: ["Business Administration", "Management", "Marketing"],
  "Public Safety": ["Criminal Justice", "Fire Science"],
  "Office & Admin": ["Business Administration", "Communications"],
  Sales: ["Marketing", "Communications", "Business Administration"],
  Hospitality: ["Hospitality Management", "Event Management"],
  "Construction & Trades": ["Construction Management"],
};
