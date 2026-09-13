const { executeQuery } = require('./db');

async function migrate() {
    console.log('🔄 Starting Multi-Tenancy DB Migration...\n');

    // 1. COMPANIES 테이블 생성
    try {
        console.log('Creating COMPANIES table if not exists...');
        await executeQuery(`
            CREATE TABLE COMPANIES (
                COMPANY_CODE VARCHAR2(50) PRIMARY KEY,
                COMPANY_NAME VARCHAR2(100) NOT NULL,
                BUSINESS_NO VARCHAR2(50),
                PLAN VARCHAR2(20) DEFAULT 'standard' CHECK (PLAN IN ('starter', 'standard', 'enterprise')),
                STATUS VARCHAR2(20) DEFAULT 'active' CHECK (STATUS IN ('active', 'suspended', 'inactive')),
                CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ COMPANIES table created.');
    } catch (err) {
        if (err.message && (err.message.includes('ORA-00955') || err.message.includes('name is already used'))) {
            console.log('ℹ️  COMPANIES table already exists.');
        } else {
            console.error('⚠️  Error creating COMPANIES table:', err.message);
        }
    }

    // 2. 기본 회사 레코드 (COMP01, COMP02) 등록
    const defaultCompanies = [
        { code: 'COMP01', name: '테크코리아 주식회사 (TechKorea)', plan: 'enterprise', bno: '101-81-12345' },
        { code: 'COMP02', name: '한일글로벌무역 (Hanil Trading)', plan: 'standard', bno: '202-86-67890' }
    ];

    for (const comp of defaultCompanies) {
        try {
            await executeQuery(
                `INSERT INTO COMPANIES (COMPANY_CODE, COMPANY_NAME, BUSINESS_NO, PLAN, STATUS)
                 VALUES (:1, :2, :3, :4, 'active')`,
                [comp.code, comp.name, comp.bno, comp.plan]
            );
            console.log(`✅ Inserted default company: ${comp.code} (${comp.name})`);
        } catch (err) {
            if (err.message && err.message.includes('ORA-00001')) {
                console.log(`ℹ️  Company ${comp.code} already exists.`);
            } else {
                console.error(`⚠️  Error inserting company ${comp.code}:`, err.message);
            }
        }
    }

    // 3. 기존 데이터의 NULL COMPANY_CODE를 COMP01로 보정
    const tables = ['USERS', 'TRIPS', 'CHECK_INS', 'EXPENSES'];
    for (const table of tables) {
        try {
            const res = await executeQuery(`UPDATE ${table} SET COMPANY_CODE = 'COMP01' WHERE COMPANY_CODE IS NULL`);
            if (res.rowsAffected > 0) {
                console.log(`✅ Updated ${res.rowsAffected} rows in ${table} with default COMPANY_CODE 'COMP01'.`);
            }
        } catch (err) {
            console.error(`⚠️  Error updating NULLs in ${table}:`, err.message);
        }
    }

    // 4. 외래키 제약조건 추가
    const fkConstraints = [
        { name: 'FK_USERS_COMPANY', table: 'USERS' },
        { name: 'FK_TRIPS_COMPANY', table: 'TRIPS' },
        { name: 'FK_CHECKINS_COMPANY', table: 'CHECK_INS' },
        { name: 'FK_EXPENSES_COMPANY', table: 'EXPENSES' }
    ];

    for (const fk of fkConstraints) {
        try {
            await executeQuery(`
                ALTER TABLE ${fk.table} 
                ADD CONSTRAINT ${fk.name} FOREIGN KEY (COMPANY_CODE) 
                REFERENCES COMPANIES(COMPANY_CODE) ON DELETE CASCADE
            `);
            console.log(`✅ Added constraint ${fk.name} on ${fk.table}`);
        } catch (err) {
            if (err.message && (err.message.includes('ORA-02275') || err.message.includes('already exists'))) {
                console.log(`ℹ️  Constraint ${fk.name} already exists.`);
            } else {
                console.log(`ℹ️  Note on ${fk.name}: ${err.message}`);
            }
        }
    }

    // 5. 복합 인덱스 생성
    const indexes = [
        { name: 'IDX_USERS_COMP_ROLE', sql: 'CREATE INDEX IDX_USERS_COMP_ROLE ON USERS(COMPANY_CODE, ROLE)' },
        { name: 'IDX_TRIPS_COMP_USER', sql: 'CREATE INDEX IDX_TRIPS_COMP_USER ON TRIPS(COMPANY_CODE, USER_ID)' },
        { name: 'IDX_TRIPS_COMP_STATUS', sql: 'CREATE INDEX IDX_TRIPS_COMP_STATUS ON TRIPS(COMPANY_CODE, STATUS)' },
        { name: 'IDX_CHECKINS_COMP_TRIP', sql: 'CREATE INDEX IDX_CHECKINS_COMP_TRIP ON CHECK_INS(COMPANY_CODE, TRIP_ID)' },
        { name: 'IDX_EXPENSES_COMP_TRIP', sql: 'CREATE INDEX IDX_EXPENSES_COMP_TRIP ON EXPENSES(COMPANY_CODE, TRIP_ID)' }
    ];

    for (const idx of indexes) {
        try {
            await executeQuery(idx.sql);
            console.log(`✅ Created index ${idx.name}`);
        } catch (err) {
            if (err.message && (err.message.includes('ORA-00955') || err.message.includes('ORA-01408') || err.message.includes('already exists'))) {
                console.log(`ℹ️  Index ${idx.name} already exists.`);
            } else {
                console.log(`ℹ️  Note on ${idx.name}: ${err.message}`);
            }
        }
    }

    console.log('\n🎉 Multi-Tenancy DB Migration Completed Successfully!');
}

migrate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });
