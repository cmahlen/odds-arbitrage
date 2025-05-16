// odds-fetcher_debug.js
import { promises as fs } from 'fs';
import fetch from 'node-fetch';

const API_KEY = '860fe7699d16d7838ad8b5d0e2a4185e';
const SPORTS_URL = `https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`;
const JSON_FILE = 'arbitrage_opportunities.json';
const HTML_OUTPUT = 'arbitrage_opportunities.html';

// Market types for analysis
const MARKET_TYPES = {
    MONEYLINE: 'h2h',
    SPREAD: 'spreads',
    TOTALS: 'totals'
};

function buildOddsUrl(sport) {
    const isOutright = sport.key.includes('winner') || sport.has_outrights;
    return `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?` +
           `apiKey=${API_KEY}` +
           `&regions=us` +
           `&markets=${isOutright ? 'outrights' : 'h2h,spreads,totals'}` +
           `&oddsFormat=american` +
           `&dateFormat=iso`;
}

async function fetchOddsData() {
    try {
        // First get list of available sports
        console.log('Fetching available sports...');
        const sportsResponse = await fetch(SPORTS_URL);
        if (!sportsResponse.ok) {
            throw new Error(`HTTP error! status: ${sportsResponse.status}`);
        }
        const sports = await sportsResponse.json();

        // Filter for active sports only
        const activeSports = sports.filter(sport => sport.active);
        console.log(`Found ${activeSports.length} active sports`);

        // Fetch odds for each sport
        console.log('Fetching odds data...');
        let allData = [];
        for (const sport of activeSports) {
            const oddsUrl = buildOddsUrl(sport);
            const response = await fetch(oddsUrl);

            if (response.ok) {
                const sportData = await response.json();
                if (sportData && sportData.length > 0) {
                    // Filter out live events by checking commence_time is in future
                    const upcomingEvents = sportData.filter(event =>
                        new Date(event.commence_time) > new Date()
                    );
                    allData = [...allData, ...upcomingEvents];
                }
            } else if (response.status !== 404) {
                console.warn(`Failed to fetch odds for ${sport.title}: ${response.status}`);
            }

            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`Fetched ${allData.length} total events`);

        return allData;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

function americanToDecimal(american) {
    if (american > 0) {
        return (american / 100) + 1;
    }
    return (100 / Math.abs(american)) + 1;
}

function calculateMarketArbitrage(bookmakers, marketType) {
    if (!bookmakers || bookmakers.length === 0) return null;

    // Get all outcomes for this market type
    const marketOutcomes = new Map();
    bookmakers.forEach(bookmaker => {
        const market = bookmaker.markets.find(m => m.key === marketType);
        if (market && market.outcomes) {
            market.outcomes.forEach(outcome => {
                const key = marketType === MARKET_TYPES.MONEYLINE
                    ? outcome.name
                    : `${outcome.name}_${outcome.point}`; // Include point for spread/totals

                if (!marketOutcomes.has(key)) {
                    marketOutcomes.set(key, []);
                }
                marketOutcomes.get(key).push({
                    price: outcome.price,
                    bookie: bookmaker.title,
                    bookieKey: bookmaker.key,
                    point: outcome.point
                });
            });
        }
    });

    if (marketOutcomes.size === 0) return null;

    // Find best odds for each outcome
    const bestOdds = new Map();
    marketOutcomes.forEach((odds, key) => {
        const best = odds.reduce((best, current) =>
            current.price > best.price ? current : best
        , odds[0]);
        bestOdds.set(key, best);
    });

    // Calculate implied probabilities
    const impliedProbs = Array.from(bestOdds.entries()).map(([key, odds]) => ({
        outcome: key,
        odds: odds.price,
        bookie: odds.bookie,
        bookieKey: odds.bookieKey,
        point: odds.point,
        impliedProb: 1 / americanToDecimal(odds.price),
        decimalOdds: americanToDecimal(odds.price)
    }));

    const totalImpliedProb = impliedProbs.reduce((sum, { impliedProb }) => sum + impliedProb, 0);

    // Calculate bet sizes if arbitrage exists
    let betSizes = {};
    if (totalImpliedProb < 1) {
        const totalStake = 1000;
        impliedProbs.forEach(({ outcome, decimalOdds }) => {
            betSizes[outcome] = (totalStake * (1 / totalImpliedProb) / decimalOdds).toFixed(2);
        });
    }

    return {
        marketType,
        opportunities: impliedProbs,
        totalImpliedProb: totalImpliedProb * 100,
        hasArbitrage: totalImpliedProb < 1,
        betSizes: totalImpliedProb < 1 ? betSizes : null,
        potentialProfit: totalImpliedProb < 1 ? ((1 / totalImpliedProb - 1) * 100).toFixed(2) + '%' : '0%'
    };
}

function analyzeEvent(event) {
    const analyses = {};

    // Analyze each market type separately
    Object.values(MARKET_TYPES).forEach(marketType => {
        const hasMarket = event.bookmakers.some(b =>
            b.markets.some(m => m.key === marketType)
        );

        if (hasMarket) {
            const analysis = calculateMarketArbitrage(event.bookmakers, marketType);
            if (analysis) {
                analyses[marketType] = analysis;
            }
        }
    });

    return {
        ...event,
        marketAnalyses: analyses,
        hasArbitrage: Object.values(analyses).some(a => a.hasArbitrage)
    };
}

function formatOdds(price) {
    return price > 0 ? `+${price}` : price.toString();
}

function createMarketSection(event, marketType, analysis) {
    if (!analysis) return '';

    const opportunities = analysis.opportunities;
    if (!opportunities || opportunities.length === 0) return '';

    // Create rows for each outcome
    const rows = opportunities.map(opp => {
        const outcomeLabel = marketType === MARKET_TYPES.MONEYLINE
            ? opp.outcome
            : `${opp.outcome} (${opp.point})`;

        return `
            <tr class="${analysis.hasArbitrage ? 'bg-green-50' : ''}">
                <td class="px-4 py-2 border">${outcomeLabel}</td>
                <td class="px-4 py-2 border">${formatOdds(opp.odds)}</td>
                <td class="px-4 py-2 border">${opp.bookie}</td>
                ${analysis.hasArbitrage ? 
                    `<td class="px-4 py-2 border">$${analysis.betSizes[opp.outcome]}</td>` : 
                    '<td class="px-4 py-2 border">-</td>'}
            </tr>
        `;
    }).join('');

    return `
        <div class="mb-6">
            <h4 class="text-lg font-semibold mb-2">${marketType.toUpperCase()}</h4>
            <table class="min-w-full divide-y divide-gray-200">
                <thead>
                    <tr class="bg-gray-50">
                        <th class="px-4 py-2 border">Outcome</th>
                        <th class="px-4 py-2 border">Best Odds</th>
                        <th class="px-4 py-2 border">Bookmaker</th>
                        <th class="px-4 py-2 border">Recommended Bet ($1000 total)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
                <tfoot>
                    <tr class="bg-gray-50">
                        <td colspan="3" class="px-4 py-2 border font-semibold">
                            Arbitrage Coefficient
                        </td>
                        <td class="px-4 py-2 border font-semibold ${
                            analysis.hasArbitrage ? 'text-green-600' : ''
                        }">
                            ${analysis.totalImpliedProb.toFixed(2)}%
                        </td>
                    </tr>
                    ${analysis.hasArbitrage ? `
                        <tr class="bg-gray-50">
                            <td colspan="3" class="px-4 py-2 border font-semibold">
                                Potential Profit
                            </td>
                            <td class="px-4 py-2 border font-semibold text-green-600">
                                ${analysis.potentialProfit}
                            </td>
                        </tr>
                    ` : ''}
                </tfoot>
            </table>
        </div>
    `;
}

function createEventCard(event) {
    const marketSections = Object.values(MARKET_TYPES)
        .map(marketType => {
            const analysis = event.marketAnalyses[marketType];
            return analysis ? createMarketSection(event, marketType, analysis) : '';
        })
        .join('');

    return `
        <div class="bg-white rounded-lg shadow-lg p-6 mb-8">
            <div class="mb-4">
                <h3 class="text-xl font-bold">${event.sport_title}</h3>
                <p class="text-gray-600">
                    ${event.home_team} vs ${event.away_team}<br>
                    ${new Date(event.commence_time).toLocaleString()}
                </p>
            </div>
            ${marketSections}
        </div>
    `;
}

function generateHTML(data) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sports Arbitrage Opportunities</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8">
    <div class="max-w-7xl mx-auto">
        <h1 class="text-3xl font-bold mb-4">Sports Arbitrage Analysis</h1>
        <p class="text-gray-600 mb-8">Last updated: ${new Date().toLocaleString()}</p>

        <!-- Arbitrage Opportunities -->
        <div class="mb-12">
            <h2 class="text-2xl font-semibold mb-6">Arbitrage Opportunities</h2>
            ${data.arbitrageOpportunities.length > 0 
                ? data.arbitrageOpportunities.map(createEventCard).join('')
                : '<p class="text-gray-500">No arbitrage opportunities found</p>'}
        </div>

        <!-- Other Opportunities -->
        <div>
            <button 
                onclick="toggleOtherOpportunities()"
                class="mb-6 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
                Show/Hide Other Opportunities
            </button>
            <div id="otherOpportunities" class="hidden">
                <h2 class="text-2xl font-semibold mb-6">Other Opportunities</h2>
                ${data.otherOpportunities.map(createEventCard).join('')}
            </div>
        </div>
    </div>

    <script>
        function toggleOtherOpportunities() {
            const div = document.getElementById('otherOpportunities');
            div.classList.toggle('hidden');
        }
    </script>
</body>
</html>`;
}

async function main() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const mode = args[0]?.toLowerCase();

        if (!mode || !['fetch', 'analyze'].includes(mode)) {
            console.log('Usage: node analyze-odds.js [fetch|analyze]');
            console.log('  fetch   - Fetch new data from API and analyze');
            console.log('  analyze - Analyze existing JSON file offline');
            return;
        }

        let eventsData;

        if (mode === 'fetch') {
            // Fetch new data from API
            console.log('Fetching fresh data from API...');
            eventsData = await fetchOddsData();
            if (!eventsData) {
                console.error('Failed to fetch data from API');
                return;
            }

            // Save raw data to JSON
            await fs.writeFile(JSON_FILE, JSON.stringify({
                timestamp: new Date().toISOString(),
                arbitrageOpportunities: [],  // Will be filled after analysis
                otherOpportunities: []       // Will be filled after analysis
            }, null, 2));

        } else {
            // Read existing JSON file
            console.log('Reading existing JSON file...');
            const jsonData = await fs.readFile(JSON_FILE, 'utf8');
            const data = JSON.parse(jsonData);
            eventsData = [...(data.arbitrageOpportunities || []), ...(data.otherOpportunities || [])];
        }

        // Process all events
        console.log('Analyzing events...');
        // In the main() function, where we process events:
        const processedEvents = eventsData
            .filter(event =>
                event.bookmakers &&
                event.bookmakers.length > 0 &&
                new Date(event.commence_time) > new Date()
    )
    .map(event => analyzeEvent(event));

        // Split into arbitrage and non-arbitrage opportunities
        const arbitrageOpps = processedEvents.filter(event => event.hasArbitrage);
        const otherOpps = processedEvents.filter(event => !event.hasArbitrage);

        // Save analyzed data back to JSON
        await fs.writeFile(JSON_FILE, JSON.stringify({
            timestamp: new Date().toISOString(),
            arbitrageOpportunities: arbitrageOpps,
            otherOpportunities: otherOpps
        }, null, 2));

        // Generate and save HTML
        console.log('Generating HTML...');
        const html = generateHTML({
            arbitrageOpportunities: arbitrageOpps,
            otherOpportunities: otherOpps
        });
        await fs.writeFile(HTML_OUTPUT, html);

        console.log('\nAnalysis Summary:');
        console.log(`Total events analyzed: ${processedEvents.length}`);
        console.log(`Arbitrage opportunities found: ${arbitrageOpps.length}`);
        console.log(`Results saved to ${HTML_OUTPUT} and ${JSON_FILE}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the script
main();