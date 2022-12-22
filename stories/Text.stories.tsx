import Spacer from 'components/Spacer';
import * as Text from 'components/Text';

export default {
	title: 'Components/Text',
	component: Text.Body,
};

export const BigText = () => {
	return (
		<div>
			<Text.BigText>Simple big text</Text.BigText>
			<Text.BigText mono>Mono big text</Text.BigText>
			<Text.BigText yellow mono kwenta>
				With Kwenta logo
			</Text.BigText>
		</div>
	);
};

export const Heading = () => {
	return (
		<div>
			<Text.Heading variant="h1">Heading 1</Text.Heading>
			<Text.Heading variant="h2">Heading 2</Text.Heading>
			<Text.Heading variant="h3">Heading 3</Text.Heading>
			<Text.Heading variant="h4">Heading 4</Text.Heading>
			<Text.Heading variant="h5">Heading 5</Text.Heading>
		</div>
	);
};

export const Body = () => {
	return (
		<div>
			<Text.Body>This is regular body text</Text.Body>
			<Text.Body size="medium">This is regular body text</Text.Body>
			<Text.Body size="large">This is regular body text</Text.Body>
			<Spacer height={8} />
			<Text.Body variant="bold">This is bold body text</Text.Body>
			<Text.Body size="medium" variant="bold">
				This is bold body text
			</Text.Body>
			<Text.Body size="large" variant="bold">
				This is bold body text
			</Text.Body>
			<Spacer height={8} />
			<Text.Body mono>This is monospaced body text</Text.Body>
			<Text.Body size="medium" mono>
				This is monospaced body text
			</Text.Body>
			<Text.Body size="large" mono>
				This is monospaced body text
			</Text.Body>
			<Spacer height={8} />
			<Text.Body mono variant="bold">
				This is bold monospaced body text
			</Text.Body>
			<Text.Body size="medium" mono variant="bold">
				This is bold monospaced body text
			</Text.Body>
			<Text.Body size="large" mono variant="bold">
				This is bold monospaced body text
			</Text.Body>
		</div>
	);
};