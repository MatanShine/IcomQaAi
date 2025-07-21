import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
import pandas as pd

def get_market_data():
    """
    Fetch latest prices for QQQ and TQQQ, and QQQ's historical volatility.
    """
    qqq = yf.Ticker("QQQ")
    tqqq = yf.Ticker("TQQQ")

    # Get the latest closing price
    qqq_price = qqq.history(period='1d')['Close'][0]
    tqqq_price = tqqq.history(period='1d')['Close'][0]

    # Get historical data for volatility calculation (1 year)
    hist = qqq.history(period="1y")
    log_returns = np.log(hist['Close'] / hist['Close'].shift(1))
    
    # Annualized volatility
    sigma = log_returns.std() * np.sqrt(252)

    # Use 10-year Treasury yield as a proxy for the risk-free rate
    tnx = yf.Ticker("^TNX")
    r = tnx.history(period='1d')['Close'][0] / 100

    return qqq_price, tqqq_price, sigma, r

def get_5y_vol_and_rate():
    """
    Compute 5-year average volatility for QQQ and average 10Y Treasury yield.
    """
    qqq = yf.Ticker("QQQ")
    tnx = yf.Ticker("^TNX")
    # 5 years of daily QQQ closes
    hist = qqq.history(period="5y")
    log_returns = np.log(hist['Close'] / hist['Close'].shift(1))
    sigma_5y = log_returns.std() * np.sqrt(252)
    # 5 years of daily 10Y Treasury yields
    tnx_hist = tnx.history(period="5y")
    r_5y = tnx_hist['Close'].mean() / 100
    return sigma_5y, r_5y

def compute_tqqq_price_map(
    S0: float,
    F0: float,
    sigma: float,
    r: float,
    A: int = 3,
    T_end_years: float = 3.0,
    n_time_points: int = 100,
    price_factor_min: float = 0.5,
    price_factor_max: float = 2.0,
    n_price_points: int = 200  # More price grids
):
    T = np.linspace(0, T_end_years, n_time_points)
    price_factors = np.linspace(price_factor_min, price_factor_max, n_price_points)
    S_grid = price_factors * S0
    decay = np.exp(- (A - 1) * (r + 0.5 * A * sigma**2) * T)
    F = F0 * np.outer((S_grid / S0)**A, decay)
    return T, S_grid, F

def plot_tqqq_map_savefig(T, S_grid, F, sigma, r, A, title, filename):
    months = T * 12
    X, Y = np.meshgrid(months, S_grid)
    n_contour_lines = 30
    plt.figure(figsize=(8, 6))
    cs_fill = plt.contourf(X, Y, F, levels=100, cmap='viridis')
    cs_lines = plt.contour(X, Y, F, colors='white', linewidths=1, levels=n_contour_lines)
    plt.clabel(cs_lines, inline=True, fontsize=7, fmt='$%.0f')
    plt.xlabel('Time to target QQQ price (months)')
    plt.ylabel('QQQ Price ($)')
    plt.ylim(S_grid[0], S_grid[-1])
    plt.title(title)
    cbar = plt.colorbar(cs_fill)
    cbar.set_label('TQQQ Price ($)', rotation=270, labelpad=30)
    plt.tight_layout()
    plt.savefig(filename, dpi=150)
    print(f"Saved: {filename}")
    plt.show()

def main():
    print("Fetching market data...")
    try:
        S0, F0, sigma, r = get_market_data()
        print(f"  - QQQ Price (S0): ${S0:.2f}")
        print(f"  - TQQQ Price (F0): ${F0:.2f}")
        print(f"  - QQQ Annual Volatility (sigma): {sigma:.3f}")
        print(f"  - Risk-Free Rate (r): {r*100:.3f}%")
    except Exception as e:
        print(f"Could not fetch market data. Using default values. Error: {e}")
        S0 = 440.0
        F0 = 55.0
        sigma = 0.25
        r = 0.04

    try:
        sigma_5y, r_5y = get_5y_vol_and_rate()
        print(f"  - 5Y Avg Volatility: {sigma_5y:.3f}")
        print(f"  - 5Y Avg 10Y Treasury: {r_5y*100:.3f}%")
    except Exception as e:
        print(f"Could not fetch 5Y averages. Using fallback. Error: {e}")
        sigma_5y = 0.22
        r_5y = 0.035

    scenarios = [
        (sigma, r, f"Current Vol: {sigma*100:.1f}%, Rate: {r*100:.2f}%", "tqqq_map_scenario1.png"),
        (0.20, r, "Volatility = 20%, Current Rate", "tqqq_map_scenario2.png"),
        (0.15, r, "Volatility = 15%, Current Rate", "tqqq_map_scenario3.png"),
        (sigma_5y, r_5y, f"5Y Avg Vol: {sigma_5y*100:.1f}%, 5Y Avg Rate: {r_5y*100:.2f}%", "tqqq_map_scenario4.png")
    ]

    for i, (scen_sigma, scen_r, scen_title, scen_file) in enumerate(scenarios):
        T, S_grid, F = compute_tqqq_price_map(
            S0, F0, scen_sigma, scen_r,
            price_factor_min=0.5,
            price_factor_max=2.0,
            n_price_points=200
        )
        plot_tqqq_map_savefig(T, S_grid, F, scen_sigma, scen_r, 3, scen_title, scen_file)

if __name__ == '__main__':
    main()