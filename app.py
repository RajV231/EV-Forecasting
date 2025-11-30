# adding details in city of interest and then addinf city in in.csv


import pandas as pd
import numpy as np
import unicodedata
from sklearn.linear_model import LinearRegression

# ----------------------------------------------------------
# Helpers
# ----------------------------------------------------------

def normalize(text: str) -> str:
    """Remove accents, trim spaces, and return lowercase ascii."""
    if pd.isna(text):
        return None
    text = str(text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.strip().lower()


def main():
    # ------------------------------------------------------
    # 1. Load Raw Data
    # ------------------------------------------------------
    ev_raw = pd.read_csv(r"backend/data/EV_Dataset_IN_sales.csv")
    chargers = pd.read_csv(r"backend/data/ev-charging-stations-india.csv")
    city_locations = pd.read_csv(r"backend/data/in.csv")

    print("✓ Files Loaded")

    # ------------------------------------------------------
    # 2. Normalize columns and names
    # ------------------------------------------------------
    ev_raw.columns = ev_raw.columns.str.strip()
    chargers.columns = chargers.columns.str.strip()
    city_locations.columns = city_locations.columns.str.strip()

    # Normalize state and city names
    ev_raw["state_norm"] = ev_raw["State"].map(normalize)
    ev_raw["Year"] = ev_raw["Year"].astype(int)

    chargers["state_norm"] = chargers["state"].map(normalize)
    chargers["city_norm"] = chargers["city"].map(normalize)

    city_locations["city_norm"] = city_locations["city"].map(normalize)
    city_locations["state_norm"] = city_locations["admin_name"].map(normalize)

    print("✓ Names normalized")

    # ------------------------------------------------------
    # 3. EV sales per state (Year 2023)
    # ------------------------------------------------------
    ev_2023 = ev_raw[ev_raw["Year"] == 2023]
    state_ev = (
        ev_2023.groupby("state_norm")["EV_Sales_Quantity"]
        .sum()
        .reset_index()
        .rename(columns={"EV_Sales_Quantity": "state_ev"})
    )

    # Manual fallback for Telangana (not present in raw 2023 data)
    # You can tweak this value if needed.
    if "telangana" not in state_ev["state_norm"].values:
        state_ev = pd.concat(
            [
                state_ev,
                pd.DataFrame(
                    {"state_norm": ["telangana"], "state_ev": [74714.0]}
                ),
            ],
            ignore_index=True,
        )

    print("✓ State-level EV sales computed for 2023")

    # ------------------------------------------------------
    # 4. Choose key cities and compute state population
    # ------------------------------------------------------
    # Cities of interest (matches your existing outputs)
    cities_of_interest = [
        "mumbai", "pune", "delhi", "chennai", "kolkata", "jaipur","surat","bangalore","hyderabad","ahmedabad","nagpur","patna",
        "lucknow", "kanpur", "mirzapur", "allahabad", "raipur", "bhopal", "vishakhapatnam", "vijayawada", "vijayapura",
        "thane", "nanded", "aurangabad"

    ]

    cities_df = city_locations[city_locations["city_norm"].isin(cities_of_interest)].copy()

    # State population = sum of populations of these selected cities
    state_pop = (
        cities_df.groupby("state_norm")["population"]
        .sum()
        .reset_index()
        .rename(columns={"population": "state_population"})
    )

    # ------------------------------------------------------
    # 5. Attach state_ev and state_population to each city
    # ------------------------------------------------------
    state_ev_map = dict(zip(state_ev["state_norm"], state_ev["state_ev"]))
    state_pop_map = dict(zip(state_pop["state_norm"], state_pop["state_population"]))

    cities_df["state_population"] = cities_df["state_norm"].map(state_pop_map)
    cities_df["state_ev"] = cities_df["state_norm"].map(state_ev_map)

    # If any state_ev is still missing, set to 0 to avoid errors
    cities_df["state_ev"] = cities_df["state_ev"].fillna(0)

    cities_df["population_share"] = (
        cities_df["population"] / cities_df["state_population"]
    )

    cities_df["estimated_ev"] = cities_df["state_ev"] * cities_df["population_share"]

    print("✓ City-level EV distribution computed")

    # ------------------------------------------------------
    # 6. Charging stations per city (from chargers dataset)
    # ------------------------------------------------------
    city_charger_counts = (
        chargers.groupby("city_norm")
        .size()
        .reset_index(name="chargingStations")
    )

    cities_df = cities_df.merge(
        city_charger_counts, on="city_norm", how="left"
    )
    cities_df["chargingStations"] = cities_df["chargingStations"].fillna(0)

    # Charger to EV ratio and gap score
    cities_df["charger_ev_ratio"] = (
        cities_df["chargingStations"] / cities_df["estimated_ev"].replace(0, np.nan)
    )
    cities_df["charger_ev_ratio"] = cities_df["charger_ev_ratio"].fillna(0)
    cities_df["gap_score"] = 1 - cities_df["charger_ev_ratio"]

    cities_df["priority"] = np.where(
        cities_df["gap_score"] > 0.9, "HIGH", "MEDIUM"
    )

    print("✓ City-level charger stats computed")

    # ------------------------------------------------------
    # 7. Build final_master.csv (city-level master)
    # ------------------------------------------------------
    # Use normalized ascii names for city and state
    cities_df["city_out"] = cities_df["city_norm"]
    cities_df["state_out"] = cities_df["state_norm"]

    final_master = cities_df[
        [
            "city_out",
            "state_out",
            "lat",
            "lng",
            "population",
            "chargingStations",
            "state_ev",
            "state_population",
            "population_share",
            "estimated_ev",
            "charger_ev_ratio",
            "gap_score",
            "priority",
        ]
    ].rename(columns={"city_out": "city", "state_out": "state"})

    final_master.to_csv(r"backend/data/final_master.csv", index=False)
    print("✓ final_master.csv saved")

    # ------------------------------------------------------
    # 8. Forecast EV demand for next 5 years (per city)
    # ------------------------------------------------------
    # Simple constant growth assumption (12% per year)
    growth_rate = 0.12

    forecast = final_master[["city", "state", "estimated_ev"]].copy()
    for i, year in enumerate(range(2025, 2030), start=1):
        forecast[f"ev_forecast_{year}"] = (
            forecast["estimated_ev"] * ((1 + growth_rate) ** i)
        ).round().astype(int)

    forecast_ev_5y = forecast[
        [
            "city",
            "state",
            "estimated_ev",
            "ev_forecast_2025",
            "ev_forecast_2026",
            "ev_forecast_2027",
            "ev_forecast_2028",
            "ev_forecast_2029",
        ]
    ]

    forecast_ev_5y.to_csv(r"backend/data/forecast_ev_5y.csv", index=False)
    print("✓ forecast_ev_5y.csv saved")

    # ------------------------------------------------------
    # 9. Charger recommendations per city
    # ------------------------------------------------------
    target_per_10k = 55  # desired chargers per 10k EVs (tunable)

    recs = final_master.merge(
        forecast_ev_5y[["city", "state", "ev_forecast_2029"]],
        on=["city", "state"],
        how="left",
    ).rename(columns={"ev_forecast_2029": "future_ev_demand"})

    recs["chargers_per_10k_ev"] = recs["chargingStations"] / (
        recs["future_ev_demand"] / 10000
    )

    recs["new_stations_needed"] = (
        target_per_10k * (recs["future_ev_demand"] / 10000)
        - recs["chargingStations"]
    ).clip(lower=0).round()

    recs["recommendation_level"] = np.where(
        recs["new_stations_needed"] > 0,
        "Critical Expansion Needed",
        "Adequate",
    )

    # Match your previous naming (chargingstations lowercase)
    charger_recommendations = recs.rename(
        columns={"chargingStations": "chargingstations"}
    )

    charger_recommendations.to_csv(
        r"backend/data/charger_recommendations.csv", index=False
    )
    print("✓ charger_recommendations.csv saved")

    # ------------------------------------------------------
    # 10. Optional: Simple national-level EV forecast (for logs)
    # ------------------------------------------------------
    # If you still want a regression-based national forecast:
    yearly_total = (
        ev_raw.groupby("Year")["EV_Sales_Quantity"].sum().reset_index()
    )
    X = yearly_total["Year"].values.reshape(-1, 1)
    y = yearly_total["EV_Sales_Quantity"].values.reshape(-1, 1)

    model = LinearRegression()
    model.fit(X, y)

    future_years = np.arange(2025, 2030).reshape(-1, 1)
    forecast_values = model.predict(future_years).flatten().astype(int)

    nat_forecast_df = pd.DataFrame(
        {"year": future_years.flatten(), "ev_sales_forecast": forecast_values}
    )
    nat_forecast_df.to_csv(
        r"backend/data/forecast_ev_5y_national.csv", index=False
    )

    print("✓ forecast_ev_5y_national.csv saved")

    print("\n--------------------------------------------")
    print("PROCESS COMPLETE")
    print("Generated files:")
    print("  ✔ backend/data/final_master.csv")
    print("  ✔ backend/data/forecast_ev_5y.csv")
    print("  ✔ backend/data/charger_recommendations.csv")
    print("  ✔ backend/data/forecast_ev_5y_national.csv (extra)")
    print("--------------------------------------------")


if __name__ == "__main__":
    main()
