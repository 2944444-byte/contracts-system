# Contracts Management System

This project is a web system for managing real estate properties and rental contracts.

The system should be built as a modern web application with a clean RTL Hebrew interface.

## Main goals
- Manage properties
- Manage rentable spaces / units
- Manage tenants
- Manage rental contracts
- Manage payments
- Manage documents
- Track occupancy by rented area versus total rentable area

## Main entities

### Properties
Each property includes:
- Name
- Address
- Total rentable area in square meters
- Notes

### Units / Spaces
Each property can contain multiple spaces.
Each space includes:
- Name or number
- Area in square meters
- Status: vacant / rented

### Tenants
Each tenant includes:
- Name
- Type: company or person
- Phone
- Email
- Notes

### Contracts
Each contract connects a property, a space, and a tenant.
Each contract includes:
- Start date
- End date
- Monthly rent
- Indexation rules
- Status

### Payments
Each payment includes:
- Related contract
- Date
- Amount
- Status

### Documents
The system should support files related to contracts and tenants.

## Product requirements
- The app should support Hebrew RTL layout
- The default entry flow should start with a login page
- After login, users should enter the main dashboard
- Use a clean admin-style layout
- Build the system in a modular way for future database integration
- For now, use mock data where needed until database integration is added

## First build priorities
1. Create login page
2. Create main dashboard layout with sidebar
3. Create properties page
4. Create tenants page
5. Create contracts page
6. Prepare the project for Supabase integration later