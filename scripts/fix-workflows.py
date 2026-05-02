#!/usr/bin/env python3
"""Adds progression/regression fields to exercise mappings in n8n workflow JSON files."""
import json

def fix_paddle_payment():
    path = '/Users/aleksejkazakov/mdt-pipeline/n8n/paddle-payment-workflow.json'
    with open(path, 'r') as f:
        d = json.load(f)

    for node in d.get('nodes', []):
        if node.get('name') == 'Build PDF Payload':
            code = node['parameters'].get('jsCode', '')
            if 'progression' in code:
                print('paddle-payment: already patched')
                continue

            # Replace warmup exercise map
            code = code.replace(
                'image_url: slot.warmup.image_url || slot.warmup.imageUrl || slot.warmup.image || slot.warmup.photo_url || slot.warmup.photoUrl || \'\',\n      cues: slot.warmup.cues\n    } : null,',
                'image_url: slot.warmup.image_url || slot.warmup.imageUrl || slot.warmup.image || slot.warmup.photo_url || slot.warmup.photoUrl || \'\',\n      cues: slot.warmup.cues,\n      progression: slot.warmup.progression || \'\',\n      regression: slot.warmup.regression || \'\'\n    } : null,'
            )
            # Replace main exercise map
            code = code.replace(
                'image_url: slot.main.image_url || slot.main.imageUrl || slot.main.image || slot.main.photo_url || slot.main.photoUrl || \'\',\n      cues: slot.main.cues\n    } : null',
                'image_url: slot.main.image_url || slot.main.imageUrl || slot.main.image || slot.main.photo_url || slot.main.photoUrl || \'\',\n      cues: slot.main.cues,\n      progression: slot.main.progression || \'\',\n      regression: slot.main.regression || \'\'\n    } : null'
            )
            node['parameters']['jsCode'] = code
            print('paddle-payment: patched Build PDF Payload')

    with open(path, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print('paddle-payment-workflow.json saved')


def fix_weekly_sender():
    path = '/Users/aleksejkazakov/mdt-pipeline/n8n/weekly-sender-workflow.json'
    with open(path, 'r') as f:
        d = json.load(f)

    for node in d.get('nodes', []):
        if node.get('name') == 'Build Job Payload':
            code = node['parameters'].get('jsCode', '')
            if 'progression' in code:
                print('weekly-sender: already patched')
                continue

            # Update the mapExercise helper to include progression and regression
            old_map = (
                'const mapExercise = (exercise) => exercise ? ({\n'
                '  name: exercise.name,\n'
                '  description: exercise.description,\n'
                '  image_url: pickImageUrl(exercise),\n'
                '  cues: exercise.cues\n'
                '}) : null;'
            )
            new_map = (
                'const mapExercise = (exercise) => exercise ? ({\n'
                '  name: exercise.name,\n'
                '  description: exercise.description,\n'
                '  image_url: pickImageUrl(exercise),\n'
                '  cues: exercise.cues,\n'
                '  progression: exercise.progression || \'\',\n'
                '  regression: exercise.regression || \'\'\n'
                '}) : null;'
            )
            if old_map in code:
                code = code.replace(old_map, new_map)
                node['parameters']['jsCode'] = code
                print('weekly-sender: patched mapExercise in Build Job Payload')
            else:
                # Try flexible matching
                import re
                pattern = r"(const mapExercise = \(exercise\) => exercise \? \(\{[^}]+cues: exercise\.cues\n\}\) : null;)"
                match = re.search(pattern, code, re.DOTALL)
                if match:
                    old_txt = match.group(1)
                    new_txt = old_txt.rstrip().rstrip('}').rstrip(')').rstrip('\n')
                    new_txt += ',\n  progression: exercise.progression || \'\',\n  regression: exercise.regression || \'\'\n}) : null;'
                    code = code.replace(old_txt, new_txt)
                    node['parameters']['jsCode'] = code
                    print('weekly-sender: patched via regex')
                else:
                    print('weekly-sender: mapExercise pattern not found, current code snippet:')
                    idx = code.find('mapExercise')
                    print(repr(code[idx:idx+300]))

    with open(path, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print('weekly-sender-workflow.json saved')


fix_paddle_payment()
fix_weekly_sender()

