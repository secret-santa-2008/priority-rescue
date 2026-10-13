IF DB_ID(N'PriorityRescue') IS NULL
BEGIN
    CREATE DATABASE PriorityRescue;
END;
GO

USE PriorityRescue;
GO

IF OBJECT_ID(N'dbo.SimulationRuns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SimulationRuns
    (
        Id              nvarchar(36)  NOT NULL CONSTRAINT PK_SimulationRuns PRIMARY KEY,
        Challenge       varchar(2)    NOT NULL,
        PipEnabled      bit           NOT NULL,
        Completed       bit           NOT NULL,
        EventsRecorded  int           NOT NULL,
        TotalEvents     int           NOT NULL,
        MetricsJson     nvarchar(max) NOT NULL,
        CreatedAt       datetime2(3)  NOT NULL CONSTRAINT DF_SimulationRuns_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_SimulationRuns_Challenge CHECK (Challenge IN ('C1','C2','C3','C4','C5')),
        CONSTRAINT CK_SimulationRuns_MetricsJson CHECK (ISJSON(MetricsJson)=1)
    );
    CREATE INDEX IX_SimulationRuns_CreatedAt ON dbo.SimulationRuns(CreatedAt DESC);
END;
GO
