export const spec = {
  "paths": {
    "/v1/company-search": {
      "get": {
        "summary": "Search companies by name",
        "description": "Search by company name. data and results contain the same results. symbol contains the original company URL path, replacing url; pass it unchanged to company endpoints.",
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": true,
            "description": "Company-name query; surrounding whitespace is removed.",
            "schema": {
              "type": "string"
            },
            "example": "reliance"
          }
        ],
        "operationId": "get_v1_company_search",
        "tags": [
          "Search"
        ],
        "x-api-style": "legacy",
        "x-use-case": "company-search",
        "x-tier": "free"
      }
    },
    "/v1/list-of-company": {
      "get": {
        "summary": "List companies",
        "description": "One-based pages of 100 companies. Each row includes the original company URL as symbol. Pagination is provided in meta: currentPage, limit, count, isNextPageAvailable, nextPage, and previousPage. Unavailable next and previous pages are null. Missing numeric values may be zero.",
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "description": "One-based page; defaults to 1. Page size is fixed at 100.",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "default": 1
            },
            "example": 1
          }
        ],
        "operationId": "get_v1_list_of_company",
        "tags": [
          "Search"
        ],
        "x-api-style": "legacy",
        "x-use-case": "company-search",
        "x-tier": "free"
      }
    },
    "/api/v1/screen": {
      "get": {
        "operationId": "get_api_v1_screen",
        "summary": "Run a company screen",
        "tags": [
          "Search"
        ],
        "description": "Run a company screen with one query expression; no company symbol or prior search is needed. Use exact measure labels. Example: Market Capitalization > 500 AND Price to Earning < 15. Comparisons, arithmetic, parentheses, AND, and OR are supported; the query limit is 4,000 characters. The public screening guide at https://github.com/auenkr/stock-market/blob/dev/docs/screening.md has the full supported Ratios and User-created ratios lists, MCP/CLI examples, and instructions for translating user criteria into expressions. Returns the query, displayed columns, matching row count, and one object per company keyed by its displayed column headings; each row also includes Symbol, the company URL path extracted from its link. Missing cells are null.",
        "parameters": [
          {
            "name": "query",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "maxLength": 4000
            },
            "description": "Financial screening expression, up to 4,000 characters. Example: Market Capitalization > 500 AND Price to Earning < 15.",
            "example": "Market Capitalization > 500 AND Price to Earning < 15"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "company-search",
        "x-tier": "free"
      }
    },
    "/api/v1/company-profile": {
      "get": {
        "operationId": "get_api_v1_company_profile",
        "summary": "Company profile",
        "tags": [
          "Company overview"
        ],
        "description": "Company description, website, exchange identifiers, classification, and market capitalization in INR crores. Missing values are null.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "company-overview",
        "x-tier": "free"
      }
    },
    "/api/v1/basic-financials": {
      "get": {
        "operationId": "get_api_v1_basic_financials",
        "summary": "Basic finance",
        "tags": [
          "Company overview"
        ],
        "description": "Summary, business description, key points, current price data, and pros/cons analysis. Prices may be delayed. Market capitalization is INR crores; unavailable shares, trade time, and volume are null.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "company-overview",
        "x-tier": "free"
      }
    },
    "/api/v1/company-documents": {
      "get": {
        "operationId": "get_api_v1_company_documents",
        "summary": "Company documents",
        "tags": [
          "Company overview"
        ],
        "description": "Company documents grouped into annual reports, announcements, credit ratings, call transcripts, presentations, and other links. Exact dates may be null; missing document groups are empty arrays.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "company-overview",
        "x-tier": "free"
      }
    },
    "/api/v1/peer-comparison": {
      "get": {
        "operationId": "get_api_v1_peer_comparison",
        "summary": "Peer comparison",
        "tags": [
          "Finance"
        ],
        "description": "Company comparison rows including URL-valued symbols, price, P/E, market capitalization, dividend yield, quarterly sales and profit, growth, and ROCE. Monetary comparison figures are INR crores except price (INR per share); percentages are percentage points.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/quarterly-profit-loss": {
      "get": {
        "operationId": "get_api_v1_quarterly_profit_loss",
        "summary": "Quarterly profit and loss",
        "tags": [
          "Finance"
        ],
        "description": "Quarterly profit and loss. Amounts are INR rupees; EPS is INR per share. Pass the URL-valued symbol unchanged.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/profit-loss": {
      "get": {
        "operationId": "get_api_v1_profit_loss",
        "summary": "Profit and loss",
        "tags": [
          "Finance"
        ],
        "description": "Annual profit and loss and available TTM results, including EBIT, EBITDA, operating profit, revenue, and tax fraction. Amounts are INR rupees; EPS is INR per share.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/balance-sheet": {
      "get": {
        "operationId": "get_api_v1_balance_sheet",
        "summary": "Balance sheet",
        "tags": [
          "Finance"
        ],
        "description": "Annual balance sheets and available detailed schedules. Amounts are INR rupees. Missing fields are null.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/cash-flow": {
      "get": {
        "operationId": "get_api_v1_cash_flow",
        "summary": "Cash flow",
        "tags": [
          "Finance"
        ],
        "description": "Annual operating, investing, and financing cash flows in INR rupees.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/ratios": {
      "get": {
        "operationId": "get_api_v1_ratios",
        "summary": "Ratios",
        "tags": [
          "Finance"
        ],
        "description": "Profitability ratios as fractions (0.25 means 25%), plus the reported historical ratio table. Only symbol is accepted.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/shareholding-pattern": {
      "get": {
        "operationId": "get_api_v1_shareholding_pattern",
        "summary": "Shareholding pattern",
        "tags": [
          "Finance"
        ],
        "description": "Quarterly ownership percentages for categories and disclosed holders. Missing percentages are null. This is not a complete shareholder register. Only symbol is accepted.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    },
    "/api/v1/shareholdings/distribution": {
      "get": {
        "operationId": "get_api_v1_shareholdings_distribution",
        "summary": "Shareholding distribution",
        "tags": [
          "Finance"
        ],
        "description": "Quarterly ownership categories and percentages by reporting period. Only URL-valued symbol is accepted. Category-specific counts, voting rights, and share totals may be null.",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Company URL path returned by company search, listing, or IPO listing. Pass unchanged.",
            "example": "/company/RELIANCE/consolidated/"
          }
        ],
        "x-api-style": "personal",
        "x-use-case": "finance",
        "x-tier": "free"
      }
    }
  }
} as const;
