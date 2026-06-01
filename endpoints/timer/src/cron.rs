//! Cron expression parser

use anyhow::Result;

/// Cron expression parser
pub struct CronParser;

impl CronParser {
    /// Parse cron expression
    pub fn parse(expr: &str) -> Result<CronExpression> {
        // TODO: Implement cron parsing
        todo!("Implement cron parsing")
    }

    /// Get next trigger time
    pub fn next_trigger(expr: &CronExpression, after: &str) -> Result<String> {
        // TODO: Implement next trigger calculation
        todo!("Implement next trigger calculation")
    }
}

/// Cron expression
#[derive(Debug, Clone)]
pub struct CronExpression {
    pub minute: Vec<u8>,
    pub hour: Vec<u8>,
    pub day_of_month: Vec<u8>,
    pub month: Vec<u8>,
    pub weekday: Vec<u8>,
}
