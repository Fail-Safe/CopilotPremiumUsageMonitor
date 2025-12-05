# Multi-Month Analysis UI - Visual Reference

## UI Layout Example

When the panel displays multi-month analysis (requires 2+ months of data), users will see:

```
┌─────────────────────────────────────────────────────────────┐
│  Copilot Premium Usage Monitor                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Current Usage Section]                                    │
│  Budget: 75% used                                           │
│  $15.00 / $20.00                                            │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Usage History                                              │
│  Current Rate: 12.5 req/hr                                  │
│  Daily Projection: 300 requests                             │
│  Weekly Projection: 2,100 requests                          │
│  Trend: ↗ Rising | High confidence                          │
│                                                              │
│  [48-hour trend chart]                                      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Multi-Month Analysis                                       │
│                                                              │
│  Analysis Period: 3 months of data                          │
│                                                              │
│  📈 Growth Trends                                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Hourly Rate: ↗ increasing                           │  │
│  │ Average: 10.2 | Change: +15.3%                      │  │
│  │ Significance: medium                                │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Daily Projection: ↗ increasing                      │  │
│  │ Average: 245.0 | Change: +15.3%                     │  │
│  │ Significance: medium                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  🔮 Next Month Predictions                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2025-12:                                            │  │
│  │ Predicted usage: 7,500 ± 450                        │  │
│  │ Confidence: high                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  📅 Seasonality Pattern                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Pattern: moderate_seasonal                          │  │
│  │ Peak Months: October, November                      │  │
│  │ Low Months: December, January                       │  │
│  │ Variation: 18.5%                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ⚠️ Anomalies Detected                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2025-10: spike                                      │  │
│  │ Expected: 6,000 | Actual: 8,500 | Deviation: +41.7%│  │
│  │ Severity: high                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  💡 Insights                                                │
│  • Usage has increased 15.3% over last 3 months            │
│  • Moderate seasonal pattern detected                      │
│  • October 2025 showed unusually high usage (spike)        │
│  • Next month predicted: ~7,500 requests                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Color Scheme

### Trend Colors
- **Increasing/Rising** ↗: Red background strip (#e51400)
- **Decreasing/Falling** ↘: Green background strip (#2d7d46)
- **Stable** →: Default foreground color

### Severity Colors
- **High Severity**: Red border (#e51400)
- **Medium/Low Severity**: Orange border (#f59d00)

### Background Colors
- **Section Boxes**: VS Code editor background
- **Main Container**: VS Code background
- **Text**: VS Code foreground color

## Responsive Behavior

### Sufficient Data (2+ months)
- All applicable sections are displayed
- Sections with no data are hidden (e.g., no anomalies = no anomaly section)

### Insufficient Data (< 2 months)
- Entire multi-month analysis section is hidden
- Only current usage and 48-hour trend chart are shown

### No Token / No Data
- Multi-month section gracefully hidden
- No error messages or empty states shown

## Font Sizes

- **Section Headings (h3)**: Default size
- **Subsection Headings (h4)**: Default size
- **Primary Text**: 1.0em
- **Secondary Text**: 0.9em
- **Tertiary Text**: 0.85em (confidence, significance levels)

## Spacing

- **Section Margin Top**: 20px
- **Item Margin**: 8px vertical
- **Item Padding**: 8px all sides
- **Border Width**: 3px (left accent border)

## Dynamic Sections

The UI dynamically shows/hides based on available data:

1. **Growth Trends**: Always shown (if 2+ months exist)
2. **Predictions**: Always shown (if 2+ months exist)
3. **Seasonality**: Only shown if pattern detected
4. **Anomalies**: Only shown if anomalies detected
5. **Insights**: Always shown (if 2+ months exist)

## Example States

### Minimal Display (2 months, no patterns)
```
Multi-Month Analysis
Analysis Period: 2 months of data

📈 Growth Trends
[trend items]

🔮 Next Month Predictions
[prediction items]

💡 Insights
• [2-3 basic insights]
```

### Full Display (6+ months with patterns)
```
Multi-Month Analysis
Analysis Period: 6 months of data

📈 Growth Trends
[trend items]

🔮 Next Month Predictions
[prediction items]

📅 Seasonality Pattern
[seasonal analysis]

⚠️ Anomalies Detected
[anomaly items]

💡 Insights
• [5-7 detailed insights]
```

## Accessibility

- Uses semantic HTML structure
- Color coding supplemented with icons and text
- High contrast with theme-aware colors
- Clear hierarchy with headings and subheadings

## Performance

- Renders in < 50ms for typical datasets
- No reflows or layout shifts
- Graceful degradation for missing data
- Responsive to window resizing

---

**Note**: The actual appearance will adapt to your VS Code theme (dark/light mode).
