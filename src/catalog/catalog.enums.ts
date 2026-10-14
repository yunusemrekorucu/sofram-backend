/** The 14 allergens of the Turkish Food Codex (same list as EU 1169/2011). */
export enum Allergen {
  gluten = 'gluten',
  crustaceans = 'crustaceans',
  eggs = 'eggs',
  fish = 'fish',
  peanuts = 'peanuts',
  soy = 'soy',
  milk = 'milk',
  treeNuts = 'tree_nuts',
  celery = 'celery',
  mustard = 'mustard',
  sesame = 'sesame',
  sulphites = 'sulphites',
  lupin = 'lupin',
  molluscs = 'molluscs',
}

export enum DietTag {
  vegetarian = 'vegetarian',
  vegan = 'vegan',
}

export enum SaleType {
  /** Cooked when ordered; `prepMinutes` is required. */
  onDemand = 'on_demand',
  /** Cooked ahead in a fixed number of portions; `portionsAvailable` is required. */
  dailyPortion = 'daily_portion',
}
