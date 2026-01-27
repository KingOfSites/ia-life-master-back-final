export type NutritionInfo = {
  calories: number;
  carbohydrates: number;
  protein: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  potassium: number;
  vitamin_c?: number;
};

export type NutritionPer100g = {
  calories: number;
  carbohydrates: number;
  protein: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  potassium?: number;
  vitamin_c?: number | null;
};

export type FoodItemAI = {
  food_id?: string;
  food_name?: string;
  confidence?: number;
  weight_g?: number;
  nutrition_per_100g?: NutritionPer100g;
  // backward-compat (se a IA responder no formato antigo)
  serving_size?: string;
  nutrition?: Partial<NutritionInfo>;
};

export type NutritionResponseAI = {
  foods: FoodItemAI[];
};
