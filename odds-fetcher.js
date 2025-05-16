// odds-fetcher.js
import { promises as fs } from 'fs';
import fetch from 'node-fetch';

const API_KEY = 'e05c83d500ee7b40b9240a4d397f7b82';

// URLs for API endpoints
const SPORTS_URL = `https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`;
const buildOddsUrl = (sport) => {
    // Check if this is an outright market by checking the sport key (more reliable than description)
    const isOutright = sport.key.includes('winner') || sport.has_outrights;

    return `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?` +
           `apiKey=${API_KEY}` +
           `&regions=us` +                    // US market
           `&markets=${isOutright ? 'outrights' : 'h2h,spreads,totals'}` +  // Include multiple markets for regular games
           `&oddsFormat=american` +           // american odds format
           `&dateFormat=iso`;                 // ISO 8601 date format
};

const JSON_OUTPUT = 'arbitrage_opportunities.json';
const HTML_OUTPUT = 'arbitrage_opportunities.html';

function americanToDecimal(american) {
    if (american > 0) {
        return (american / 100) + 1;
    }
    return (100 / Math.abs(american)) + 1;
}

function createTableRow(event, analysis) {
    const allBookieOdds = {};

    // Extract unique bookmaker keys from the data
    const bookmakers = [...new Set(event.bookmakers.map(b => b.key))];

    // Initialize with n/a for all bookmakers
    bookmakers.forEach(bookie => {
        allBookieOdds[bookie] = {
            home: 'n/a',
            away: 'n/a'
        };
    });

    // Fill in the actual odds where available
    event.bookmakers.forEach(bookmaker => {
        const homeOutcome = bookmaker.markets[0].outcomes.find(o => o.name === event.home_team);
        const awayOutcome = bookmaker.markets[0].outcomes.find(o => o.name === event.away_team);

        allBookieOdds[bookmaker.key] = {
            home: homeOutcome ? homeOutcome.price : 'n/a',
            away: awayOutcome ? awayOutcome.price : 'n/a'
        };
    });

    // Create bookmaker columns
    const bookieColumns = bookmakers.map(bookie => {
        const isHomeBest = analysis.hasArbitrage && analysis.opportunities.find(
            opp => opp.team === event.home_team && analysis.bestBookies[event.home_team + '_key'] === bookie
        );
        const isAwayBest = analysis.hasArbitrage && analysis.opportunities.find(
            opp => opp.team === event.away_team && analysis.bestBookies[event.away_team + '_key'] === bookie
        );

        const homeClass = isHomeBest ? 'text-green-600 font-bold' : '';
        const awayClass = isAwayBest ? 'text-green-600 font-bold' : '';

        return `
            <td class="px-6 py-4 border text-center whitespace-nowrap">
                <div class="leading-relaxed">
                    <div class="${homeClass}">
                        ${allBookieOdds[bookie].home !== 'n/a' ? 
                            (allBookieOdds[bookie].home > 0 ? '+' : '') + allBookieOdds[bookie].home : 'n/a'}
                    </div>
                    <div class="${awayClass}">
                        ${allBookieOdds[bookie].away !== 'n/a' ? 
                            (allBookieOdds[bookie].away > 0 ? '+' : '') + allBookieOdds[bookie].away : 'n/a'}
                    </div>
                </div>
            </td>
        `;
    }).join('');

    const lastUpdate = new Date(event.bookmakers[0].last_update).toLocaleString();

    return `
        <tr class="${analysis.hasArbitrage ? 'bg-green-50' : ''}">
            <td class="px-6 py-4 border whitespace-nowrap">${event.sport_title}</td>
            <td class="px-6 py-4 border whitespace-nowrap">
                <div class="leading-relaxed">
                    ${event.home_team}<br>${event.away_team}
                </div>
            </td>
            ${bookieColumns}
            <td class="px-6 py-4 border whitespace-nowrap">${lastUpdate}</td>
            <td class="px-6 py-4 border text-right whitespace-nowrap">
                ${analysis.totalImpliedProb.toFixed(2)}%
            </td>
        </tr>
    `;
}

function createTable(events) {
    if (events.length === 0) {
        return '<p class="p-4 text-gray-500">No opportunities found</p>';
    }

    // Get unique bookmakers from all events
    const bookmakers = [...new Set(events.flatMap(event =>
        event.bookmakers.map(b => b.key)
    ))];

    // Create header row
    const headerRow = `
        <tr class="bg-gray-50">
            <th class="px-6 py-3 border text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sport</th>
            <th class="px-6 py-3 border text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teams</th>
            ${bookmakers.map(bookie => 
                `<th class="px-6 py-3 border text-center text-xs font-medium text-gray-500 uppercase tracking-wider">${bookie}</th>`
            ).join('')}
            <th class="px-6 py-3 border text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Update</th>
            <th class="px-6 py-3 border text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Arbitrage Coefficient</th>
        </tr>
    `;

    // Create table
    return `
        <table class="min-w-full divide-y divide-gray-200">
            <thead>
                ${headerRow}
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${events.map(event => createTableRow(event, event.analysis)).join('')}
            </tbody>
        </table>
    `;
}

function generateHTML(arbitrageOpps, otherOpps, lastUpdate) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sports Arbitrage Opportunities</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .hidden {
            display: none;
        }
    </style>
</head>
<body class="bg-gray-100 p-8">
    <div class="max-w-full mx-auto">
        <h1 class="text-3xl font-bold mb-4">Sports Arbitrage Analysis</h1>
        <p class="text-gray-600 mb-8">Last updated: ${lastUpdate}</p>

        <!-- Arbitrage Opportunities -->
        <div class="mb-8">
            <h2 class="text-2xl font-semibold mb-4">Arbitrage Opportunities</h2>
            <div class="bg-white rounded-lg shadow overflow-x-auto">
                ${createTable(arbitrageOpps)}
            </div>
        </div>

        <!-- Other Opportunities -->
        <div>
            <button 
                onclick="toggleOtherOpportunities()"
                class="mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
                Show/Hide Other Opportunities
            </button>
            <div id="otherOpportunities" class="hidden">
                <h2 class="text-2xl font-semibold mb-4">Other Opportunities</h2>
                <div class="bg-white rounded-lg shadow overflow-x-auto">
                    ${createTable(otherOpps)}
                </div>
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

function calculateArbitrage(bookmakers) {
    if (!bookmakers || bookmakers.length === 0) return null;

    let bestOdds = {};
    let bestBookies = {};
    let allOdds = {};

    const teams = new Set();
    // Track all markets and outcomes
    bookmakers.forEach(bookmaker => {
        if (bookmaker.markets) {
            bookmaker.markets.forEach(market => {
                if (market.outcomes) {
                    market.outcomes.forEach(outcome => {
                        const key = `${market.key}_${outcome.name}`;
                        teams.add(key);
                        if (!allOdds[key]) {
                            allOdds[key] = [];
                        }
                        // For spread and totals markets, include the point value
                        const oddsInfo = {
                            bookie: bookmaker.title,
                            odds: outcome.price,
                            market: market.key
                        };
                        if (outcome.point !== undefined) {
                            oddsInfo.point = outcome.point;
                        }
                        allOdds[key].push(oddsInfo);
                    });
                }
            });
        }
    });

    teams.forEach(team => {
        let best = -Infinity;
        let bestBookie = '';
        let bestBookieKey = '';

        bookmakers.forEach(bookmaker => {
            if (bookmaker.markets && bookmaker.markets[0] && bookmaker.markets[0].outcomes) {
                const outcome = bookmaker.markets[0].outcomes.find(o => o.name === team);
                if (outcome && outcome.price > best) {
                    best = outcome.price;
                    bestBookie = bookmaker.title;
                    bestBookieKey = bookmaker.key;
                }
            }
        });

        bestOdds[team] = best;
        bestBookies[team] = bestBookie;
        bestBookies[team + '_key'] = bestBookieKey;
    });

    const impliedProbs = Object.entries(bestOdds).map(([team, odds]) => ({
        team,
        odds,
        bookie: bestBookies[team],
        allOdds: allOdds[team],
        impliedProb: 1 / americanToDecimal(odds),
        decimalOdds: americanToDecimal(odds)
    }));

    const totalImpliedProb = impliedProbs.reduce((sum, { impliedProb }) => sum + impliedProb, 0);

    let betSizes = {};
    if (totalImpliedProb < 1) {
        const totalStake = 1000;
        impliedProbs.forEach(({ team, decimalOdds }) => {
            betSizes[team] = (totalStake * (1 / totalImpliedProb) / decimalOdds).toFixed(2);
        });
    }

    return {
        opportunities: impliedProbs,
        totalImpliedProb: totalImpliedProb * 100,
        hasArbitrage: totalImpliedProb < 1,
        betSizes: totalImpliedProb < 1 ? betSizes : null,
        potentialProfit: totalImpliedProb < 1 ? ((1 / totalImpliedProb - 1) * 100).toFixed(2) + '%' : '0%',
        bestBookies: bestBookies  // Include the bestBookies in the analysis
    };
}

async function fetchAndAnalyzeOdds() {
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
            const oddsUrl = buildOddsUrl(sport);  // Pass the complete sport object
            const response = await fetch(oddsUrl);

            if (response.ok) {
                const sportData = await response.json();
                if (sportData && sportData.length > 0) {
                    allData = [...allData, ...sportData];
                }
            } else if (response.status !== 404) { // Ignore 404s as some sports might not have current odds
                console.warn(`Failed to fetch odds for ${sport.title}: ${response.status}`);
            }

            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`Fetched ${allData.length} total events`);

        // Process all events
        const processedEvents = allData
            .filter(event => event.bookmakers && event.bookmakers.length > 0)
            .map(event => {
                const analysis = calculateArbitrage(event.bookmakers);
                return {
                    ...event,
                    analysis
                };
            });

        // Split into arbitrage and non-arbitrage opportunities
        const arbitrageOpps = processedEvents.filter(event => event.analysis && event.analysis.hasArbitrage);
        const otherOpps = processedEvents.filter(event => event.analysis && !event.analysis.hasArbitrage);

        // Generate HTML
        const html = generateHTML(arbitrageOpps, otherOpps, new Date().toLocaleString());
        await fs.writeFile(HTML_OUTPUT, html);

        // Save JSON for reference
        await fs.writeFile(
            JSON_OUTPUT,
            JSON.stringify({
                timestamp: new Date().toISOString(),
                arbitrageOpportunities: arbitrageOpps,
                otherOpportunities: otherOpps
            }, null, 2)
        );

        console.log('\nAnalysis Summary:');
        console.log(`Total events analyzed: ${processedEvents.length}`);
        console.log(`Arbitrage opportunities found: ${arbitrageOpps.length}`);
        console.log(`Results saved to ${HTML_OUTPUT} and ${JSON_OUTPUT}`);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the script
fetchAndAnalyzeOdds();