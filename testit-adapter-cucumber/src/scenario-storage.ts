import {
GherkinDocument,
Pickle,
PickleStep,
TestCase,
TestCaseFinished,
TestCaseStarted,
TestStepFinished,
TestStepStarted,
} from '@cucumber/messages';
import {
    TestResult,
    Attachment,
    TestResultStep,
    calculateResultOutcome,
    Link
} from 'testit-js-commons';
import { IStorage } from './types/storage';
import {
mapDate,
mapStatus,
} from './scenario-parser';
import { parseTags } from './tags-parser';

export class Storage implements IStorage {
    private gherkinDocuments: GherkinDocument[] = [];
    private pickles: Pickle[] = [];
    private testCases: TestCase[] = [];
    private testCasesStarted: TestCaseStarted[] = [];
    private testCasesFinished: TestCaseFinished[] = [];
    private testStepsStarted: TestStepStarted[] = [];
    private testStepsFinished: TestStepFinished[] = [];
    private messages: Record<string, string[]> = {};
    private resultLinks: Record<string, Link[]> = {};
    private attachments: Record<string, Attachment[]> = {};

    isResolvedTestCase(testCase: TestCase): boolean {
        for (const pickle of this.pickles) {
            const tags = parseTags(pickle.tags);
            
            if (tags.externalId !== undefined && testCase.pickleId === pickle.id) {
                return true;
            }
        }

        return false;
    }

    saveGherkinDocument(document: GherkinDocument): void {
        this.gherkinDocuments.push(document);
    }

    savePickle(pickle: Pickle): void {
        this.pickles.push(pickle);
    }

    saveTestCase(testCase: TestCase): void {
        this.testCases.push(testCase);
    }

    saveTestCaseStarted(testCaseStarted: TestCaseStarted): void {
        this.testCasesStarted.push(testCaseStarted);
    }

    saveTestCaseFinished(testCaseFinished: TestCaseFinished): void {
        this.testCasesFinished.push(testCaseFinished);
    }

    saveTestStepStarted(testStepStarted: TestStepStarted): void {
        this.testStepsStarted.push(testStepStarted);
    }

    saveTestStepFinished(testStepFinished: TestStepFinished): void {
        this.testStepsFinished.push(testStepFinished);
    }

    getTestResult(testId: string): TestResult {
        const testCase = this.testCases.find(
            (testCase) => testCase.id === testId
        );

        if (testCase === undefined) {
            throw new Error('TestCase not found');
        };

        const pickle = this.pickles.find(
            (pickle) => pickle.id === testCase.pickleId
        );

        if (pickle === undefined) {
            throw new Error('Pickle not found');
        }

        const tags = parseTags(pickle.tags);

        if (tags.externalId === undefined) {
            throw new Error('External ID is not provided');
        }

        const testCaseStarted = this.testCasesStarted.find(
            (testCase) => testCase.id === testCase.id
        );

        if (testCaseStarted === undefined) {
            throw new Error('TestCaseStarted not found');
        };

        const testCaseFinished = this.testCasesFinished.find(
            (testCase) => testCase.testCaseStartedId === testCaseStarted.id
        );

        if (testCaseFinished === undefined) {
            throw new Error('TestCaseFinished not found');
        };
        
        const steps = pickle.steps
            .map((step) => this.getStepResult(step, testCase))
            .filter((item, i, arr) => {
            const prevOutcome = arr[i - 1]?.outcome;
            if (
                item.outcome === 'Skipped' &&
                prevOutcome !== undefined &&
                ['Failed', 'Skipped'].includes(prevOutcome)
            ) {
                return false;
            }
            return true;
            });

        const messages: string[] = [];

        for (const step of pickle.steps) {
            const message = this.getStepMessage(step, testCase);
            if (message !== undefined) {
            messages.push(message);
            }
        }
        const resultLinks = this.resultLinks[testCase.id] ?? [];

        return {
            externalId: tags.externalId,
            displayName: tags.name ?? pickle.name,
            links: tags.links,
            resultLinks: resultLinks,
            stepResults: steps,
            outcome: calculateResultOutcome(steps.map((step) => step.outcome)),
            startedOn: mapDate(testCaseStarted.timestamp.seconds),
            completedOn: mapDate(testCaseFinished.timestamp.seconds),
            duration:
                testCaseFinished.timestamp.seconds -
                testCaseStarted.timestamp.seconds,
            message: this.messages[testCase.id]?.join('\n\n') ?? undefined,
            traces: messages.join('\n\n'),
            attachments: this.getAttachments(testCase.id),
        };
    }

    getStepResult(
        pickleStep: PickleStep,
        testCase: TestCase
    ): TestResultStep {
        const testStep = testCase.testSteps.find(
            (step) => step.pickleStepId === pickleStep.id
        );

        if (testStep === undefined) {
            throw new Error('TestCase step not found');
        }

        const testStepStarted = this.testStepsStarted.find(
            (step) => step.testStepId === testStep.id
        );

        if (testStepStarted === undefined) {
            throw new Error('TestStepStarted not found');
        }

        const testStepFinished = this.testStepsFinished.find(
            (step) => step.testStepId === testStepStarted.testStepId
        );

        if (testStepFinished === undefined) {
            throw new Error('TestStepFinished not found');
        }

        return {
            title: pickleStep.text,
            startedOn: mapDate(testStepStarted.timestamp.seconds),
            duration: testStepFinished.testStepResult.duration.seconds,
            completedOn: mapDate(testStepFinished.timestamp.seconds),
            outcome: mapStatus(testStepFinished.testStepResult.status),
        };
    }

    getStepMessage(
        pickleStep: PickleStep,
        testCase: TestCase
    ): string | undefined {
        const testStep = testCase.testSteps.find(
            (step) => step.pickleStepId === pickleStep.id
        );

        if (testStep === undefined) {
            throw new Error('TestCase step not found');
        }

        const testStepStarted = this.testStepsStarted.find(
            (step) => step.testStepId === testStep.id
        );

        if (testStepStarted === undefined) {
            throw new Error('TestStepStarted not found');
        }

        const testStepFinished = this.testStepsFinished.find(
            (step) => step.testStepId === testStepStarted.testStepId
        );

        if (testStepFinished === undefined) {
            throw new Error('TestStepFinished not found');
        }

        return testStepFinished.testStepResult.message;
    }

    getAttachments(testCaseId: string): Attachment[] | undefined {
        if (this.attachments[testCaseId] === undefined) {
            return undefined;
        }

        return this.attachments[testCaseId];
    }

    addMessage(testCaseId: string, message: string): void {
        if (this.messages[testCaseId] === undefined) {
            this.messages[testCaseId] = [message];
        } else {
            this.messages[testCaseId].push(message);
        }
    }

    addLinks(testCaseId: string, links: Link[]): void {
        if (this.resultLinks[testCaseId] === undefined) {
            this.resultLinks[testCaseId] = links;
        } else {
            this.resultLinks[testCaseId].push(...links);
        }
    }

    addAttachment(testCaseId: string, attachmentId: string): void {
        const attachment = {
            'id': attachmentId
        };

        if (this.attachments[testCaseId] === undefined) {
            this.attachments[testCaseId] = [attachment];
        } else {
            this.attachments[testCaseId].concat(attachment);
        }
    }
}
