# Multi-Month Analysis UI Integration

## Overview

The multi-month analysis feature has been fully integrated into the webview UI, displaying intelligent insights, predictions, seasonality patterns, and anomalies.

## What's Included

### 1. Backend Integration
- **File**: `src/extension.ts`
- **Changes**: Modified `calculateCompleteUsageData()` to call `usageHistoryManager.analyzeMultiMonthTrends()`
- **Data Flow**: Analysis results are included in the `historyData` object sent to the webview via the `multiMonthAnalysis` property

### 2. Frontend Rendering
- **File**: `media/webview.js`
- **New Function**: `renderMultiMonthAnalysis(analysis)` - Renders all analysis components
- **Integration Point**: Called from `renderUsageHistory()` when multi-month data is available

### 3. UI Components

The multi-month analysis section includes:

#### Analysis Summary
- Shows number of months of data analyzed
- Displays only when 2+ months of data are available

#### Growth Trends 📈
- Metric-specific trend indicators (↗ rising, ↘ falling, → stable)
- Color-coded by direction (red for increasing, green for decreasing)
- Shows average value, change percentage, and significance level
- Metrics tracked: hourly rate, daily projection, weekly projection

#### Predictions 🔮
- Next month usage predictions
- Confidence intervals (±X range)
- Confidence level indicators (high/medium/low)
- Based on linear regression and historical patterns

#### Seasonality Pattern 📅
- Detected seasonal patterns (if any)
- Peak months identification
- Low usage months identification
- Variance percentage showing seasonality strength
- Only displayed when seasonality is detected

#### Anomalies ⚠️
- Unusual usage patterns detected
- Severity levels (high/medium/low) with color coding
- Expected vs actual values
- Deviation percentage
- Anomaly type classification

#### Insights 💡
- Bullet-pointed intelligent insights
- Actionable recommendations
- Usage pattern observations
- Based on comprehensive trend analysis

## Visual Design

### Color Coding
- **Increasing trends**: Red (`#e51400`)
- **Decreasing trends**: Green (`#2d7d46`)
- **Stable trends**: Default foreground color
- **High severity**: Red
- **Medium/Low severity**: Orange (`#f59d00`)

### Layout
- Sections use VS Code theme colors via CSS variables
- Each component has padding and background for clarity
- Border-left accent colors for visual hierarchy
- Responsive font sizing (0.85em - 1.0em)

### Icons
- 📈 Growth Trends
- 🔮 Predictions
- 📅 Seasonality
- ⚠️ Anomalies
- 💡 Insights

## Data Requirements

The UI gracefully handles various data states:
- **No data**: Section is hidden
- **< 2 months**: Section is hidden with message
- **2+ months**: Full analysis displayed
- **Missing components**: Individual sections are conditionally rendered

## Testing

To test the multi-month UI:

1. **Install the beta extension**:
   ```bash
   code --install-extension copilot-premium-usage-monitor-0.9.0-beta.vsix
   ```

2. **Wait for data accumulation**:
   - The extension collects hourly snapshots
   - After 2+ months, multi-month analysis becomes available
   - You can simulate by manually editing globalState (advanced)

3. **Check the panel**:
   - Open the Copilot Usage Panel
   - Scroll past the usage history section
   - Multi-month analysis appears below the trend chart

4. **Test with different data**:
   - Increasing trends: Should show red arrows and predictions
   - Decreasing trends: Should show green arrows
   - Seasonal patterns: Only appears if detected
   - Anomalies: Only appears if unusual patterns found

## Development Notes

### Dynamic Section Creation
The UI dynamically creates the multi-month section if it doesn't exist in the HTML template, ensuring backwards compatibility.

### Logging
Debug logs are included (behind try/catch) to help troubleshoot rendering issues without breaking the UI.

### Performance
- All rendering is synchronous and fast
- No external API calls during render
- Analysis is pre-computed in the backend

## Future Enhancements

Potential improvements:
1. **Interactive charts**: Click to see detailed monthly breakdowns
2. **Export data**: Download analysis as JSON/CSV
3. **Comparison view**: Compare current month to historical averages
4. **Alerts**: Configurable notifications for anomalies
5. **Custom date ranges**: User-selectable analysis periods

## Related Files

- `src/lib/usageHistory.ts` - Analysis engine implementation
- `src/extension.ts` - Data flow and calculation
- `media/webview.js` - UI rendering
- `media/webview.css` - Styling (uses CSS variables)
- `docs/BETA-TESTING.md` - Beta testing guide

## Version

This feature is available in **v0.9.0-beta** and later.
