"use client";

import {
  DATAFORSEO_LOCATIONS,
  findLanguageOption,
  findLocationOption,
  languageOptionsForValue,
  locationOptionsForValue,
  selectFieldClassName,
} from "@/lib/seo/dataforseo-catalog";

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
  );
}

export function SeoLocationLanguageFields({
  locationCode,
  languageCode,
  serpDepth,
  depthMin,
  depthMax,
  disabled,
  onLocationChange,
  onLanguageChange,
  onDepthChange,
}: {
  locationCode: string;
  languageCode: string;
  serpDepth: string;
  depthMin: number;
  depthMax: number;
  disabled?: boolean;
  onLocationChange: (code: string) => void;
  onLanguageChange: (code: string) => void;
  onDepthChange: (depth: string) => void;
}) {
  const locNum = Number(locationCode);
  const locationOptions = Number.isFinite(locNum)
    ? locationOptionsForValue(locNum)
    : DATAFORSEO_LOCATIONS;
  const languageOptions = languageOptionsForValue(languageCode);

  const selectedLocation = Number.isFinite(locNum)
    ? (findLocationOption(locNum) ?? locationOptions.find((o) => o.code === locNum))
    : undefined;
  const selectedLanguage = findLanguageOption(languageCode.trim());

  const depthOptions: number[] = [];
  for (let d = depthMin; d <= depthMax; d += 1) {
    depthOptions.push(d);
  }

  const countries = locationOptions.filter((o) => o.group === "country");
  const cities = locationOptions.filter((o) => o.group === "city");

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor="seo-location">
          Ubicación de búsqueda
        </label>
        <select
          id="seo-location"
          className={selectFieldClassName}
          disabled={disabled}
          value={locationCode}
          onChange={(e) => onLocationChange(e.target.value)}
        >
          {countries.length > 0 ? (
            <optgroup label="Países">
              {countries.map((item) => (
                <option key={item.code} value={String(item.code)}>
                  {item.labelEs}
                </option>
              ))}
            </optgroup>
          ) : null}
          {cities.length > 0 ? (
            <optgroup label="Ciudades">
              {cities.map((item) => (
                <option key={item.code} value={String(item.code)}>
                  {item.labelEs}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {selectedLocation ? (
          <FieldHint>
            <span className="tabular-nums">({selectedLocation.code})</span>
            {selectedLocation.countryIso ? (
              <span className="text-muted-foreground"> · {selectedLocation.countryIso}</span>
            ) : null}
          </FieldHint>
        ) : Number.isFinite(locNum) ? (
          <FieldHint>
            <span className="tabular-nums">({locNum})</span>
          </FieldHint>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor="seo-language">
          Idioma
        </label>
        <select
          id="seo-language"
          className={selectFieldClassName}
          disabled={disabled}
          value={languageCode}
          onChange={(e) => onLanguageChange(e.target.value)}
        >
          {languageOptions.map((item) => (
            <option key={item.code} value={item.code}>
              {item.labelEs}
            </option>
          ))}
        </select>
        {selectedLanguage ? (
          <FieldHint>
            <span>({selectedLanguage.code})</span>
          </FieldHint>
        ) : languageCode.trim() ? (
          <FieldHint>
            <span>({languageCode.trim()})</span>
          </FieldHint>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor="seo-depth">
          Profundidad SERP
        </label>
        <select
          id="seo-depth"
          className={selectFieldClassName}
          disabled={disabled}
          value={serpDepth}
          onChange={(e) => onDepthChange(e.target.value)}
        >
          {depthOptions.map((d) => (
            <option key={d} value={String(d)}>
              {d} {d === 1 ? "resultado" : "resultados"}
              {d === 10 ? " (predeterminado)" : ""}
            </option>
          ))}
        </select>
        <FieldHint>
          <span className="tabular-nums">({serpDepth || "—"})</span>
        </FieldHint>
      </div>
    </div>
  );
}
