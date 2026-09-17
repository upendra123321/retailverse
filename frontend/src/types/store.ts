export interface StoreZone {
  zone_id: string;
  type: "product" | "checkout" | "structure" | "ad" | string;
  category: string;
  product_key?: string;
  display_name: string;
  instance_count?: number;
  mesh_node_names?: string[];
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
}

export interface StoreLayout {
  source_model: string;
  store_bounds: { min: [number, number, number]; max: [number, number, number] };
  attention_relevant_types: string[];
  product_instance_count: number;
  zone_count: number;
  zones: StoreZone[];
}

export interface AdZoneVariant {
  variant_id: string;
  label: string;
  position: [number, number, number];
  rotation_y_deg: number;
  creative_color: string;
  creative_text: string;
}

export interface AdSlot {
  slot_id: string;
  description: string;
  size: { width: number; height: number };
  variants: AdZoneVariant[];
}

export interface AdZonesConfig {
  ad_slots: AdSlot[];
}

export interface Persona {
  persona_key: string;
  label: string;
  description: string;
  navigation_style: "direct" | "explore" | "compare";
  target_categories: string[];
  preferred_product_keys: string[];
  patience_seconds: number;
  browse_probability: number;
  ad_attention_bias: number;
  price_sensitivity: "low" | "medium" | "high";
  purchase_likelihood: number;
}
