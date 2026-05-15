/**
 * Catálogo curado para Ajustes SEO (DataForSEO Keywords Data).
 * Códigos de ubicación: locations_kwrd_2026_04_06.csv (actualizado 2026-04-06).
 * Idiomas: API /v3/keywords_data/google/languages (ISO 639-1).
 */

export type DataforseoLocationOption = {
  code: number;
  /** Nombre mostrado al usuario (español). */
  labelEs: string;
  /** Nombre oficial en DataForSEO (inglés). */
  locationName: string;
  countryIso: string;
  group: "country" | "city";
};

/** Países y ciudades frecuentes en mercados hispanos + referentes globales. */
export const DATAFORSEO_LOCATIONS: DataforseoLocationOption[] = [
  { code: 2484, labelEs: "México", locationName: "Mexico", countryIso: "MX", group: "country" },
  { code: 2724, labelEs: "España", locationName: "Spain", countryIso: "ES", group: "country" },
  { code: 2840, labelEs: "Estados Unidos", locationName: "United States", countryIso: "US", group: "country" },
  { code: 2032, labelEs: "Argentina", locationName: "Argentina", countryIso: "AR", group: "country" },
  { code: 2170, labelEs: "Colombia", locationName: "Colombia", countryIso: "CO", group: "country" },
  { code: 2152, labelEs: "Chile", locationName: "Chile", countryIso: "CL", group: "country" },
  { code: 2604, labelEs: "Perú", locationName: "Peru", countryIso: "PE", group: "country" },
  { code: 2076, labelEs: "Brasil", locationName: "Brazil", countryIso: "BR", group: "country" },
  { code: 2862, labelEs: "Venezuela", locationName: "Venezuela", countryIso: "VE", group: "country" },
  { code: 2218, labelEs: "Ecuador", locationName: "Ecuador", countryIso: "EC", group: "country" },
  { code: 2320, labelEs: "Guatemala", locationName: "Guatemala", countryIso: "GT", group: "country" },
  { code: 2188, labelEs: "Costa Rica", locationName: "Costa Rica", countryIso: "CR", group: "country" },
  { code: 2591, labelEs: "Panamá", locationName: "Panama", countryIso: "PA", group: "country" },
  { code: 2858, labelEs: "Uruguay", locationName: "Uruguay", countryIso: "UY", group: "country" },
  { code: 2600, labelEs: "Paraguay", locationName: "Paraguay", countryIso: "PY", group: "country" },
  { code: 2068, labelEs: "Bolivia", locationName: "Bolivia", countryIso: "BO", group: "country" },
  { code: 2214, labelEs: "República Dominicana", locationName: "Dominican Republic", countryIso: "DO", group: "country" },
  { code: 2124, labelEs: "Canadá", locationName: "Canada", countryIso: "CA", group: "country" },
  { code: 2826, labelEs: "Reino Unido", locationName: "United Kingdom", countryIso: "GB", group: "country" },
  { code: 2250, labelEs: "Francia", locationName: "France", countryIso: "FR", group: "country" },
  { code: 2276, labelEs: "Alemania", locationName: "Germany", countryIso: "DE", group: "country" },
  { code: 2380, labelEs: "Italia", locationName: "Italy", countryIso: "IT", group: "country" },
  { code: 2620, labelEs: "Portugal", locationName: "Portugal", countryIso: "PT", group: "country" },
  { code: 20703, labelEs: "Ciudad de México", locationName: "Mexico City,Mexico", countryIso: "MX", group: "city" },
  { code: 1005493, labelEs: "Madrid", locationName: "Madrid,Community of Madrid,Spain", countryIso: "ES", group: "city" },
  { code: 1005424, labelEs: "Barcelona", locationName: "Barcelona,Barcelona,Catalonia,Spain", countryIso: "ES", group: "city" },
  { code: 1003659, labelEs: "Bogotá", locationName: "Bogota,Bogota,Colombia", countryIso: "CO", group: "city" },
  { code: 1003325, labelEs: "Santiago de Chile", locationName: "Santiago,Santiago Metropolitan Region,Chile", countryIso: "CL", group: "city" },
  { code: 9073192, labelEs: "Lima", locationName: "Lima,Lima,Lima Province,Peru", countryIso: "PE", group: "city" },
  { code: 1001773, labelEs: "São Paulo", locationName: "Sao Paulo,State of Sao Paulo,Brazil", countryIso: "BR", group: "city" },
  { code: 20010, labelEs: "Buenos Aires", locationName: "Buenos Aires,Argentina", countryIso: "AR", group: "city" },
  { code: 1028528, labelEs: "Caracas", locationName: "Caracas,Capital District,Venezuela", countryIso: "VE", group: "city" },
  { code: 9069516, labelEs: "Quito", locationName: "Quito,Pichincha,Ecuador", countryIso: "EC", group: "city" },
  { code: 1007583, labelEs: "Ciudad de Guatemala", locationName: "Guatemala City,Guatemala Department,Guatemala", countryIso: "GT", group: "city" },
  { code: 1003683, labelEs: "San José (Costa Rica)", locationName: "San Jose,San Jose Province,Costa Rica", countryIso: "CR", group: "city" },
  { code: 1012872, labelEs: "Montevideo", locationName: "Montevideo,Montevideo Department,Uruguay", countryIso: "UY", group: "city" },
  { code: 1011782, labelEs: "Asunción", locationName: "Asuncion,Asuncion,Paraguay", countryIso: "PY", group: "city" },
  { code: 1023191, labelEs: "Nueva York", locationName: "New York,New York,United States", countryIso: "US", group: "city" },
  { code: 1013962, labelEs: "Los Ángeles", locationName: "Los Angeles,California,United States", countryIso: "US", group: "city" },
  { code: 1015116, labelEs: "Miami", locationName: "Miami,Florida,United States", countryIso: "US", group: "city" },
  { code: 1006886, labelEs: "Londres", locationName: "London,England,United Kingdom", countryIso: "GB", group: "city" },
  { code: 9040871, labelEs: "París", locationName: "Paris,Ile-de-France,France", countryIso: "FR", group: "city" },
  { code: 20226, labelEs: "Berlín", locationName: "Berlin,Germany", countryIso: "DE", group: "city" },
  { code: 9206269, labelEs: "Roma", locationName: "Rome,Lazio,Italy", countryIso: "IT", group: "city" },
  { code: 9198446, labelEs: "Lisboa", locationName: "Lisbon,Lisbon,Portugal", countryIso: "PT", group: "city" },
];

export type DataforseoLanguageOption = {
  code: string;
  labelEs: string;
  nameEn: string;
};

/** Idiomas soportados por Google Ads / DataForSEO Keywords Data. */
export const DATAFORSEO_LANGUAGES: DataforseoLanguageOption[] = [
  { code: "es", labelEs: "Español", nameEn: "Spanish" },
  { code: "en", labelEs: "Inglés", nameEn: "English" },
  { code: "pt", labelEs: "Portugués", nameEn: "Portuguese" },
  { code: "fr", labelEs: "Francés", nameEn: "French" },
  { code: "de", labelEs: "Alemán", nameEn: "German" },
  { code: "it", labelEs: "Italiano", nameEn: "Italian" },
  { code: "ca", labelEs: "Catalán", nameEn: "Catalan" },
  { code: "nl", labelEs: "Neerlandés", nameEn: "Dutch" },
  { code: "pl", labelEs: "Polaco", nameEn: "Polish" },
  { code: "ru", labelEs: "Ruso", nameEn: "Russian" },
  { code: "ja", labelEs: "Japonés", nameEn: "Japanese" },
  { code: "ko", labelEs: "Coreano", nameEn: "Korean" },
  { code: "zh-CN", labelEs: "Chino (simplificado)", nameEn: "Chinese (Simplified)" },
  { code: "zh-TW", labelEs: "Chino (tradicional)", nameEn: "Chinese (Traditional)" },
  { code: "ar", labelEs: "Árabe", nameEn: "Arabic" },
  { code: "bg", labelEs: "Búlgaro", nameEn: "Bulgarian" },
  { code: "hr", labelEs: "Croata", nameEn: "Croatian" },
  { code: "cs", labelEs: "Checo", nameEn: "Czech" },
  { code: "da", labelEs: "Danés", nameEn: "Danish" },
  { code: "el", labelEs: "Griego", nameEn: "Greek" },
  { code: "et", labelEs: "Estonio", nameEn: "Estonian" },
  { code: "fi", labelEs: "Finés", nameEn: "Finnish" },
  { code: "he", labelEs: "Hebreo", nameEn: "Hebrew" },
  { code: "hi", labelEs: "Hindi", nameEn: "Hindi" },
  { code: "hu", labelEs: "Húngaro", nameEn: "Hungarian" },
  { code: "id", labelEs: "Indonesio", nameEn: "Indonesian" },
  { code: "lt", labelEs: "Lituano", nameEn: "Lithuanian" },
  { code: "lv", labelEs: "Letón", nameEn: "Latvian" },
  { code: "ms", labelEs: "Malayo", nameEn: "Malay" },
  { code: "no", labelEs: "Noruego", nameEn: "Norwegian" },
  { code: "ro", labelEs: "Rumano", nameEn: "Romanian" },
  { code: "sk", labelEs: "Eslovaco", nameEn: "Slovak" },
  { code: "sl", labelEs: "Esloveno", nameEn: "Slovenian" },
  { code: "sr", labelEs: "Serbio", nameEn: "Serbian" },
  { code: "sv", labelEs: "Sueco", nameEn: "Swedish" },
  { code: "th", labelEs: "Tailandés", nameEn: "Thai" },
  { code: "tr", labelEs: "Turco", nameEn: "Turkish" },
  { code: "uk", labelEs: "Ucraniano", nameEn: "Ukrainian" },
  { code: "vi", labelEs: "Vietnamita", nameEn: "Vietnamese" },
];

const locationByCode = new Map(
  DATAFORSEO_LOCATIONS.map((item) => [item.code, item] as const),
);

const languageByCode = new Map(
  DATAFORSEO_LANGUAGES.map((item) => [item.code, item] as const),
);

export function findLocationOption(code: number): DataforseoLocationOption | undefined {
  return locationByCode.get(code);
}

export function findLanguageOption(code: string): DataforseoLanguageOption | undefined {
  return languageByCode.get(code);
}

/** Incluye valor guardado aunque no esté en el catálogo curado. */
export function locationOptionsForValue(
  selectedCode: number,
): DataforseoLocationOption[] {
  if (findLocationOption(selectedCode)) {
    return DATAFORSEO_LOCATIONS;
  }
  return [
    {
      code: selectedCode,
      labelEs: "Ubicación personalizada",
      locationName: `Código ${selectedCode}`,
      countryIso: "",
      group: "country",
    },
    ...DATAFORSEO_LOCATIONS,
  ];
}

export function languageOptionsForValue(
  selectedCode: string,
): DataforseoLanguageOption[] {
  const normalized = selectedCode.trim();
  if (!normalized || findLanguageOption(normalized)) {
    return DATAFORSEO_LANGUAGES;
  }
  return [
    {
      code: normalized,
      labelEs: "Idioma personalizado",
      nameEn: normalized,
    },
    ...DATAFORSEO_LANGUAGES,
  ];
}

export const selectFieldClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
